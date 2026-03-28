import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PlyLoader } from './loadPly';
import { Splats } from './splats';
import { mat4, vec3 } from 'wgpu-matrix';

export function WebGPUSplat({ url, splatRadius = 1 }: { url: string, splatRadius?: number }) {
  const { gl, camera, size } = useThree();
  const [splats, setSplats] = useState<Splats | null>(null);
  const [viewParamBindGroup, setViewParamBindGroup] = useState<GPUBindGroup | null>(null);
  const buffersRef = useRef<any>({});
  
  useEffect(() => {
    let isMounted = true;

    async function init() {
      // Access WebGPU device and context from Three.js WebGPURenderer
      const backend = (gl as any).backend;
      if (!backend) return;
      const device = backend.device as GPUDevice;
      if (!device) return;

      const format = navigator.gpu.getPreferredCanvasFormat();

      const viewParamBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} }
        ],
      });

      const projectionBuffer = device.createBuffer({
        size: 16 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const screenSizeBuffer = device.createBuffer({
        size: 2 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const modelViewBuffer = device.createBuffer({
        size: 16 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const splatRadiusBuffer = device.createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: viewParamBindGroupLayout,
        entries: [
          { binding: 0, resource: {buffer: projectionBuffer} },
          { binding: 1, resource: {buffer: modelViewBuffer} },
          { binding: 2, resource: {buffer: screenSizeBuffer} },
          { binding: 3, resource: {buffer: splatRadiusBuffer} }
        ],
      });

      buffersRef.current = { projectionBuffer, screenSizeBuffer, modelViewBuffer, splatRadiusBuffer };
      setViewParamBindGroup(bindGroup);

      try {
        const parser = new PlyLoader();
        const gaussianBuffers = await parser.loadFromUrl(url);

        if (isMounted) {
          const newSplats = new Splats(device, gaussianBuffers, viewParamBindGroupLayout, format);
          setSplats(newSplats);
        }
      } catch (e) {
        console.error("Failed to load PLY:", e);
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [gl, url]);

  const lastCamPos = useRef(vec3.zero());
  const lastCamRot = useRef(vec3.zero());
  const visibleCountRef = useRef<number>(0);

  // Render after Three.js
  useFrame(({ gl, scene, camera }) => {
    try {
      // 1. Render Three.js scene first
      gl.render(scene, camera);

      if (!splats || !viewParamBindGroup) return;

      const backend = (gl as any).backend;
      if (!backend) return;
      const device = backend.device as GPUDevice;
      const context = backend.getContext ? backend.getContext() as GPUCanvasContext : null;
      if (!device || !context) return;

      let shouldUpdate = false;
      const camPos = vec3.create(camera.position.x, camera.position.y, camera.position.z);
      const camRot = vec3.create(camera.rotation.x, camera.rotation.y, camera.rotation.z);
      
      if(vec3.distance(lastCamPos.current, camPos) > 0.1 || vec3.distance(lastCamRot.current, camRot) > 0.1){
          vec3.copy(camPos, lastCamPos.current);
          vec3.copy(camRot, lastCamRot.current);
          shouldUpdate = true;
      }

      // Update buffers using queue.writeBuffer (more efficient than staging buffers)
      const projection = new Float32Array(camera.projectionMatrix.elements);
      const modelView = new Float32Array(camera.matrixWorldInverse.elements);

      // Directly write to uniform buffers using queue.writeBuffer
      device.queue.writeBuffer(buffersRef.current.projectionBuffer, 0, projection);
      device.queue.writeBuffer(buffersRef.current.modelViewBuffer, 0, modelView);
      device.queue.writeBuffer(buffersRef.current.screenSizeBuffer, 0, new Float32Array([size.width, size.height]));
      device.queue.writeBuffer(buffersRef.current.splatRadiusBuffer, 0, new Float32Array([splatRadius]));

      const commandEncoder = device.createCommandEncoder();

      let visibleCount: number | null = null;
      if (shouldUpdate) {
        visibleCount = splats.updateSplatIndexBuffer(device, projection, modelView, commandEncoder);
        if (visibleCount !== null) {
          visibleCountRef.current = visibleCount;
          console.log(`Rendering ${visibleCount} splats out of ${splats['_numVertices']} total (${Math.round(visibleCount / splats['_numVertices'] * 100)}% visible)`);
        }
      }

      const renderPassDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "load", // Preserve Three.js render
            storeOp: "store"
        }]
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
      splats.render(renderPass, viewParamBindGroup, visibleCountRef.current);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    } catch (err) {
      console.error("Error in WebGPUSplat useFrame:", err);
    }
  }, 1); // priority 1 to render after Three.js

  return null;
}
