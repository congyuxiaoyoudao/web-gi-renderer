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
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], 'splat.ply');

        const parser = new PlyLoader();
        await parser.loadPlyFile(file);

        if (isMounted) {
          const newSplats = new Splats(device, parser.getSplattifiedVertices(), viewParamBindGroupLayout, format);
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

      // Update buffers
      const projection = new Float32Array(camera.projectionMatrix.elements);
      const modelView = new Float32Array(camera.matrixWorldInverse.elements);

      const projectionUpdateBuffer = device.createBuffer({
        size: 16 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
      });
      new Float32Array(projectionUpdateBuffer.getMappedRange()).set(projection);
      projectionUpdateBuffer.unmap();

      const modelViewUpdateBuffer = device.createBuffer({
        size: 16 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
      });
      new Float32Array(modelViewUpdateBuffer.getMappedRange()).set(modelView);
      modelViewUpdateBuffer.unmap();

      const screenSizeUpdateBuffer = device.createBuffer({
        size: 2 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
      });
      new Float32Array(screenSizeUpdateBuffer.getMappedRange()).set([size.width, size.height]);
      screenSizeUpdateBuffer.unmap();

      const splatRadiusUpdateBuffer = device.createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true
      });
      new Float32Array(splatRadiusUpdateBuffer.getMappedRange())[0] = splatRadius;
      splatRadiusUpdateBuffer.unmap();

      const commandEncoder = device.createCommandEncoder();
      commandEncoder.copyBufferToBuffer(projectionUpdateBuffer, 0, buffersRef.current.projectionBuffer, 0, 16 * Float32Array.BYTES_PER_ELEMENT);
      commandEncoder.copyBufferToBuffer(screenSizeUpdateBuffer, 0, buffersRef.current.screenSizeBuffer, 0, 2 * Float32Array.BYTES_PER_ELEMENT);
      commandEncoder.copyBufferToBuffer(modelViewUpdateBuffer, 0, buffersRef.current.modelViewBuffer, 0, 16 * Float32Array.BYTES_PER_ELEMENT);
      commandEncoder.copyBufferToBuffer(splatRadiusUpdateBuffer, 0, buffersRef.current.splatRadiusBuffer, 0, Float32Array.BYTES_PER_ELEMENT);
      
      let splatIndexBuffer: GPUBuffer | null = null;
      if (shouldUpdate) {
        splatIndexBuffer = splats.updateSplatIndexBuffer(device, projection, modelView, commandEncoder);
      }

      const renderPassDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "load", // Preserve Three.js render
            storeOp: "store"
        }]
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
      splats.render(renderPass, viewParamBindGroup);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
      
      projectionUpdateBuffer.destroy();
      screenSizeUpdateBuffer.destroy();
      modelViewUpdateBuffer.destroy();
      splatRadiusUpdateBuffer.destroy();
      if (splatIndexBuffer != null) {
        splatIndexBuffer.destroy();
      }
    } catch (err) {
      console.error("Error in WebGPUSplat useFrame:", err);
    }
  }, 1); // priority 1 to render after Three.js

  return null;
}
