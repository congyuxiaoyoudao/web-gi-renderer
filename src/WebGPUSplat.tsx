import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PlyLoader } from './loadPly';
import { Splats } from './splats';
import { vec3 } from 'wgpu-matrix';
import * as THREE from 'three/webgpu';

export function WebGPUSplat({
  url,
  splatRadius = 1,
  sortMethod = 'GPU',
  debugDepth = false,
  shDegree = 3,
  gaussianTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }
}: {
  url: string,
  splatRadius?: number,
  sortMethod?: string,
  debugDepth?: boolean,
  shDegree?: number,
  gaussianTransform?: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
}) {
  const { gl, camera, size, scene } = useThree();
  const [splats, setSplats] = useState<Splats | null>(null);
  const [viewParamBindGroup, setViewParamBindGroup] = useState<GPUBindGroup | null>(null);
  const buffersRef = useRef<any>({});
  const depthRenderTargetRef = useRef<THREE.RenderTarget | null>(null);
  // Reuse a single material for the depth prepass — never recreate per-frame
  const depthOverrideMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      const backend = (gl as any).backend;
      if (!backend) return;
      const device = backend.device as GPUDevice;
      if (!device) return;

      const format = navigator.gpu.getPreferredCanvasFormat();
      // depth32float is guaranteed because we create DepthTexture with THREE.FloatType
      const depthFormat: GPUTextureFormat = 'depth32float';

      const dpr = window.devicePixelRatio;
      const width = Math.floor(size.width * dpr);
      const height = Math.floor(size.height * dpr);
      const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
      depthRenderTargetRef.current = new THREE.RenderTarget(width, height, { depthTexture });
      depthOverrideMaterialRef.current = new THREE.MeshBasicMaterial({ colorWrite: false });

      const viewParamBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'} },
          { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
          { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'} },
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

      const shDegreeBuffer = device.createBuffer({
        size: 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const camPosModelBuffer = device.createBuffer({
        size: 4 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: viewParamBindGroupLayout,
        entries: [
          { binding: 0, resource: {buffer: projectionBuffer} },
          { binding: 1, resource: {buffer: modelViewBuffer} },
          { binding: 2, resource: {buffer: screenSizeBuffer} },
          { binding: 3, resource: {buffer: splatRadiusBuffer} },
          { binding: 4, resource: {buffer: debugDepthBuffer} },
          { binding: 5, resource: {buffer: shDegreeBuffer} },
          { binding: 6, resource: {buffer: camPosModelBuffer} },
        ],
      });

      buffersRef.current = { projectionBuffer, screenSizeBuffer, modelViewBuffer, splatRadiusBuffer, debugDepthBuffer, shDegreeBuffer, camPosModelBuffer };
      setViewParamBindGroup(bindGroup);

      try {
        const parser = new PlyLoader();

        if (!url) {
          if (isMounted) {
            setSplats(null);
          }
          return;
        }

        const gaussianBuffers = await parser.loadFromUrl(url);

        if (isMounted) {
          const newSplats = new Splats(device, gaussianBuffers, viewParamBindGroupLayout, format, depthFormat);

          // Release large CPU arrays now that data is in GPU buffers.
          const gb = gaussianBuffers as any;
          gb.cov3d = null;
          gb.colors = null;
          gb.shCoeffs = null;

          setSplats(newSplats);
        }
      } catch (e) {
        console.error("Failed to load PLY:", e);
      }
    }

    init();

    return () => {
      isMounted = false;
      depthRenderTargetRef.current?.dispose();
      depthRenderTargetRef.current = null;
      depthOverrideMaterialRef.current?.dispose();
      depthOverrideMaterialRef.current = null;
    };
  }, [gl, size.width, size.height, url]);

  const lastCamPos = useRef(vec3.zero());
  const lastCamRot = useRef(vec3.zero());
  const visibleCountRef = useRef<number>(0);

  // Render splats with depth testing against Three.js scene
  useFrame((state) => {
    const { camera } = state;
    try {
      const backend = (gl as any).backend;
      if (!backend) return;

      const device = backend.device as GPUDevice;
      const context = backend.getContext ? backend.getContext() as GPUCanvasContext : null;
      if (!device || !context) return;

      if (!splats || !viewParamBindGroup) {
        // Keep rendering the regular Three.js scene when no splat source is active.
        (gl as any).render(scene, camera);
        return;
      }

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

      // Ensure camera matrices are up-to-date before reading
      camera.updateMatrixWorld(true);

      // Update uniform buffers
      const projection = new Float32Array(camera.projectionMatrix.elements);
      // Build model matrix: Translation * Rotation * COLMAP→Three.js flip
      const splatModelMatrix = new THREE.Matrix4()
        .makeTranslation(gaussianTransform.position.x, gaussianTransform.position.y, gaussianTransform.position.z)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
          gaussianTransform.rotation.x * Math.PI / 180,
          gaussianTransform.rotation.y * Math.PI / 180,
          gaussianTransform.rotation.z * Math.PI / 180
        )))
        .multiply(new THREE.Matrix4().makeScale(1, -1, -1));
      const viewMatrix = camera.matrixWorldInverse.clone();
      viewMatrix.multiply(splatModelMatrix);
      const modelView = new Float32Array(viewMatrix.elements);

      device.queue.writeBuffer(buffersRef.current.projectionBuffer, 0, projection);
      device.queue.writeBuffer(buffersRef.current.modelViewBuffer, 0, modelView);
      device.queue.writeBuffer(buffersRef.current.screenSizeBuffer, 0, new Float32Array([width, height]));
      device.queue.writeBuffer(buffersRef.current.splatRadiusBuffer, 0, new Float32Array([splatRadius]));
      device.queue.writeBuffer(buffersRef.current.debugDepthBuffer, 0, new Float32Array([debugDepth ? 1.0 : 0.0]));

      // Cap SH degree to what the loaded model actually supports
      const effectiveSHDegree = Math.min(shDegree, splats.maxSHDegree);
      device.queue.writeBuffer(buffersRef.current.shDegreeBuffer, 0, new Uint32Array([effectiveSHDegree]));

      // Compute camera position in model space for view-dependent SH evaluation
      const camPosWorld = camera.position.clone();
      const camPosModel = camPosWorld.applyMatrix4(splatModelMatrix.clone().invert());
      device.queue.writeBuffer(buffersRef.current.camPosModelBuffer, 0, new Float32Array([camPosModel.x, camPosModel.y, camPosModel.z, 0]));

      const commandEncoder = device.createCommandEncoder();

      let visibleCount: number | null = null;
      if (shouldUpdate) {
        if (sortMethod === 'GPU') {
          splats.updateSplatIndexBufferGPU(device, modelView, commandEncoder);
          visibleCount = splats['_numVertices'];
        } else {
          visibleCount = splats.updateSplatIndexBuffer(device, projection, modelView, commandEncoder);
        }

        if (visibleCount !== null) {
          visibleCountRef.current = visibleCount;
        }
      }

      // Step 1: Depth prepass — render scene to RenderTarget so Three.js allocates the depth GPU texture
      if (depthRenderTargetRef.current && depthOverrideMaterialRef.current) {
        const savedOverride = scene.overrideMaterial;
        scene.overrideMaterial = depthOverrideMaterialRef.current;
        try {
          (gl as any).setRenderTarget(depthRenderTargetRef.current);
          (gl as any).render(scene, camera);
          (gl as any).setRenderTarget(null);
        } finally {
          scene.overrideMaterial = savedOverride;
        }
      }

      // Step 2: Render scene color to canvas
      (gl as any).render(scene, camera);

      // Step 3: Extract depth GPU texture — available after the first prepass
      let depthTextureView: GPUTextureView | null = null;
      if (depthRenderTargetRef.current?.depthTexture) {
        const td = backend.get(depthRenderTargetRef.current.depthTexture);
        if (td?.texture) depthTextureView = (td.texture as GPUTexture).createView();
      }
      if (!depthTextureView) {
        // First frame before Three.js allocates the texture — skip splat render this frame
        device.queue.submit([commandEncoder.finish()]);
        return;
      }

      // Step 4: Render splats on top with depth test
      const renderPassDesc: GPURenderPassDescriptor = {
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: "load",
          storeOp: "store"
        }],
        depthStencilAttachment: {
          view: depthTextureView,
          depthReadOnly: true
        }
      };

      const renderPass = commandEncoder.beginRenderPass(renderPassDesc);
      splats.render(renderPass, viewParamBindGroup, visibleCountRef.current);
      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);
    } catch (err) {
      console.error("Error in WebGPUSplat useFrame:", err);
    }
  }, 1);

  return null;
}
