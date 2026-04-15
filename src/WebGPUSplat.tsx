import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PlyLoader } from './loadPly';
import { Splats } from './splats';
import { vec3 } from 'wgpu-matrix';
import * as THREE from 'three/webgpu';
import { clipSpace, vec4, mix } from 'three/tsl';

// Depth-only material for prepass - writes to depth buffer only
const depthMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false,  // Don't write to color buffer
  depthWrite: true,
  depthTest: true
});

// Depth visualization material using TSL for WebGPU compatibility
const depthVisualizeMaterial = new THREE.MeshBasicNodeMaterial({
  colorNode: mix(
    vec4(1, 0.27, 0, 1),
    vec4(0, 0.52, 0.8, 1),
    clipSpace.z.div(clipSpace.w).mul(0.5).add(0.5)  // NDC depth in [0, 1]
  )
});

export function WebGPUSplat({
  url,
  splatRadius = 1,
  debugDepth = false
}: {
  url: string,
  splatRadius?: number,
  debugDepth?: boolean
}) {
  const { gl, camera, size, scene } = useThree();
  const [splats, setSplats] = useState<Splats | null>(null);
  const [viewParamBindGroup, setViewParamBindGroup] = useState<GPUBindGroup | null>(null);
  const buffersRef = useRef<any>({});
  const depthBindGroupLayoutRef = useRef<GPUBindGroupLayout | null>(null);
  const depthSamplerRef = useRef<GPUSampler | null>(null);
  const depthTextureRef = useRef<GPUTexture | null>(null);
  const depthTextureViewRef = useRef<GPUTextureView | null>(null);

  // Three.js render target for depth prepass
  const depthRenderTargetRef = useRef<THREE.RenderTarget | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      // Access WebGPU device and context from Three.js WebGPURenderer
      const backend = (gl as any).backend;
      if (!backend) return;
      const device = backend.device as GPUDevice;
      if (!device) return;

      const format = navigator.gpu.getPreferredCanvasFormat();
      const dpr = window.devicePixelRatio;
      const width = Math.floor(size.width * dpr);
      const height = Math.floor(size.height * dpr);

      // Create Three.js RenderTarget for depth prepass with explicit DepthTexture
      // Use RenderTarget instead of WebGLRenderTarget for WebGPU compatibility
      const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
      const depthRenderTarget = new THREE.RenderTarget(width, height, {
        depthTexture: depthTexture
      });
      depthRenderTargetRef.current = depthRenderTarget;

      // Create depth texture bind group layout
      const depthBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }
        ]
      });
      depthBindGroupLayoutRef.current = depthBindGroupLayout;

      // Create depth sampler for comparison
      const depthSampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        compare: 'less-equal'
      });
      depthSamplerRef.current = depthSampler;

      const viewParamBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'} }
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

      const debugDepthBuffer = device.createBuffer({
        size: Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: viewParamBindGroupLayout,
        entries: [
          { binding: 0, resource: {buffer: projectionBuffer} },
          { binding: 1, resource: {buffer: modelViewBuffer} },
          { binding: 2, resource: {buffer: screenSizeBuffer} },
          { binding: 3, resource: {buffer: splatRadiusBuffer} },
          { binding: 4, resource: {buffer: debugDepthBuffer} }
        ],
      });

      buffersRef.current = { projectionBuffer, screenSizeBuffer, modelViewBuffer, splatRadiusBuffer, debugDepthBuffer };
      setViewParamBindGroup(bindGroup);

      try {
        const parser = new PlyLoader();
        const gaussianBuffers = await parser.loadFromUrl(url);

        if (isMounted) {
          const newSplats = new Splats(device, gaussianBuffers, viewParamBindGroupLayout, format, depthBindGroupLayout);
          setSplats(newSplats);
        }
      } catch (e) {
        console.error("Failed to load PLY:", e);
      }
    }

    init();

    return () => {
      isMounted = false;
      if (depthTextureRef.current) {
        depthTextureRef.current.destroy();
      }
      if (depthRenderTargetRef.current) {
        depthRenderTargetRef.current.dispose();
      }
    };
  }, [gl, size.width, size.height, url]);

  const lastCamPos = useRef(vec3.zero());
  const lastCamRot = useRef(vec3.zero());
  const visibleCountRef = useRef<number>(0);

  // Render with depth testing against Three.js scene
  useFrame((state) => {
    const { camera, scene } = state;
    try {
      if (!splats || !viewParamBindGroup) return;

      // Get WebGPU backend from Three.js renderer
      const backend = (gl as any).backend;
      if (!backend) return;

      const device = backend.device as GPUDevice;
      const context = backend.getContext ? backend.getContext() as GPUCanvasContext : null;
      if (!device || !context) return;

      const dpr = window.devicePixelRatio;
      const width = Math.floor(size.width * dpr);
      const height = Math.floor(size.height * dpr);

      let shouldUpdate = false;
      const camPos = vec3.create(camera.position.x, camera.position.y, camera.position.z);
      const camRot = vec3.create(camera.rotation.x, camera.rotation.y, camera.rotation.z);

      if(vec3.distance(lastCamPos.current, camPos) > 0.1 || vec3.distance(lastCamRot.current, camRot) > 0.1){
          vec3.copy(camPos, lastCamPos.current);
          vec3.copy(camRot, lastCamRot.current);
          shouldUpdate = true;
      }

      // Update buffers using queue.writeBuffer
      const projection = new Float32Array(camera.projectionMatrix.elements);
      const modelView = new Float32Array(camera.matrixWorldInverse.elements);

      device.queue.writeBuffer(buffersRef.current.projectionBuffer, 0, projection);
      device.queue.writeBuffer(buffersRef.current.modelViewBuffer, 0, modelView);
      device.queue.writeBuffer(buffersRef.current.screenSizeBuffer, 0, new Float32Array([size.width, size.height]));
      device.queue.writeBuffer(buffersRef.current.splatRadiusBuffer, 0, new Float32Array([splatRadius]));
      device.queue.writeBuffer(buffersRef.current.debugDepthBuffer, 0, new Float32Array([debugDepth ? 1.0 : 0.0]));

      const commandEncoder = device.createCommandEncoder();

      // Step 1: Render scene depth to RenderTarget (for depth testing)
      if (depthRenderTargetRef.current) {
        const originalOverride = scene.overrideMaterial;
        scene.overrideMaterial = depthMaterial;

        try {
          (gl as any).setRenderTarget(depthRenderTargetRef.current);
          (gl as any).render(scene, camera);
          (gl as any).setRenderTarget(null);
        } catch (err) {
          console.error('Failed to render depth prepass:', err);
        }

        scene.overrideMaterial = originalOverride;

        // Get GPU depth texture from render target
        const depthTexture = depthRenderTargetRef.current.depthTexture;
        if (depthTexture) {
          const textureData = backend.get(depthTexture);
          const gpuTexture = textureData?.texture;

          if (gpuTexture) {
            depthTextureRef.current = gpuTexture;
            depthTextureViewRef.current = gpuTexture.createView();
          }
        }
      }

      // Step 2: Render scene to screen (normal or depth visualization)
      const originalOverride = scene.overrideMaterial;
      scene.overrideMaterial = debugDepth ? depthVisualizeMaterial : null;
      (gl as any).render(scene, camera);
      scene.overrideMaterial = originalOverride;

      let visibleCount: number | null = null;
      if (shouldUpdate) {
        visibleCount = splats.updateSplatIndexBuffer(device, projection, modelView, commandEncoder);
        if (visibleCount !== null) {
          visibleCountRef.current = visibleCount;
        }
      }

      // Create depth bind group
      let depthBindGroupForRender: GPUBindGroup | undefined = undefined;
      if (depthTextureViewRef.current && depthSamplerRef.current && depthBindGroupLayoutRef.current) {
        depthBindGroupForRender = device.createBindGroup({
          layout: depthBindGroupLayoutRef.current,
          entries: [
            { binding: 0, resource: depthTextureViewRef.current },
            { binding: 1, resource: depthSamplerRef.current }
          ]
        });
      }

      // Step 3: Render splats with depth testing
      const renderPassDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "load",  // Load previous content (scene depth visualization)
            storeOp: "store"
        }]
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
      splats.render(renderPass, viewParamBindGroup, visibleCountRef.current, depthBindGroupForRender);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    } catch (err) {
      console.error("Error in WebGPUSplat useFrame:", err);
    }
  }, 1);

  return null;
}
