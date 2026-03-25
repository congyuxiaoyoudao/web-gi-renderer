import { Gaussian } from './loadPly';
import type { Mat4 } from 'wgpu-matrix'
import splat_shader from './splat_shader';

export class Splats {
    private _renderPipeline: GPURenderPipeline;
    private _numVertices: number;
    private _splatBindGroup: GPUBindGroup;
    private _splatPositionBuffer: GPUBuffer;
    private _splatIdsBuffer: GPUBuffer;
    private _cov3dBuffer: GPUBuffer;
    private _splats: Gaussian[];
 
    constructor(device: GPUDevice, vertices: Gaussian[], viewParamsBindGroupLayout: GPUBindGroupLayout, format: GPUTextureFormat, depthFormat?: GPUTextureFormat) {
        const shaderModule = device.createShaderModule({
            code: splat_shader
        });
    
        const positions = new Float32Array(vertices.flatMap(vertex => [...vertex.position, 0.0]));
        const cov3d = new Float32Array(vertices.flatMap(vertex => vertex.cov3d));
        const colors = new Float32Array(vertices.flatMap(vertex => [...vertex.color,vertex.opacity]))

        // UPLPOAD SPLAT DATA TO GPU AS UNIFORMS
        // each splat has its color, position and cov3d buffer
        const splatBindGroupLayout = device?.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' }
                }
            ],
        });
        const positionsBuffer = device?.createBuffer({
            size: 4 * Float32Array.BYTES_PER_ELEMENT * vertices.length,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
            mappedAtCreation: true,
        });
        const positionsData = positionsBuffer.getMappedRange();
        new Float32Array(positionsData).set(positions);
        positionsBuffer.unmap();
        
        const cov3dBuffer = device?.createBuffer({
            size: 8 * Float32Array.BYTES_PER_ELEMENT * vertices.length,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        const cov3dData = cov3dBuffer.getMappedRange();
        new Float32Array(cov3dData).set(cov3d);
        cov3dBuffer.unmap();

        const colorsBuffer = device?.createBuffer({
            size: 4 * Float32Array.BYTES_PER_ELEMENT * vertices.length,
            usage: GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        const colorsData = colorsBuffer.getMappedRange();
        new Float32Array(colorsData).set(colors);
        colorsBuffer.unmap();

        const splatBindGroup = device?.createBindGroup({
            layout: splatBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {buffer: positionsBuffer},
                },
                {
                    binding: 1,
                    resource: {buffer: cov3dBuffer},
                },
                {
                    binding: 2,
                    resource: {buffer: colorsBuffer},
                }
            ],
        });
    
        //CREATE VERTEX ATTRIBUTE BUFFERS
        // 2*2 quad
        const splatPos = new Float32Array([
            1, 1,
            -1, 1,
            1, -1,
            -1, -1
        ]);
        const splatPosBuffer = device?.createBuffer({
            size: 2 * Float32Array.BYTES_PER_ELEMENT * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        const splatPosData = splatPosBuffer.getMappedRange();
        new Float32Array(splatPosData).set(splatPos);
        splatPosBuffer.unmap();
        const splatPositionBufferLayoutDescriptor: GPUVertexBufferLayout = {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            stepMode: 'vertex',
            attributes: [{
                format: 'float32x2',
                offset: 0,
                shaderLocation: 0
            }]
        };

        const splatIds = new Uint32Array(vertices.length).fill(0).map((_, i) => i);
        const splatIdsBuffer = device?.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT * vertices.length,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        const splatIdsData = splatIdsBuffer.getMappedRange();
        new Uint32Array(splatIdsData).set(splatIds);
        splatIdsBuffer.unmap();

        const splatIdsBufferLayoutDescriptor: GPUVertexBufferLayout = {
            arrayStride: Uint32Array.BYTES_PER_ELEMENT,
            stepMode: 'instance',
            attributes: [{
                format: 'uint32',
                offset: 0,
                shaderLocation: 1
            }]
        };

        
        //CREATE PIPELINE
        const colorState: GPUColorTargetState = {
            format: format,
            blend: {
                alpha: {
                    operation: "add",
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                },
                color: {
                    operation: "add",
                    srcFactor: 'src-alpha',
                    dstFactor: 'one-minus-src-alpha',
                }
            }
        };  

        const renderPipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts:[viewParamsBindGroupLayout, splatBindGroupLayout]
            }),
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [
                    splatPositionBufferLayoutDescriptor, 
                    splatIdsBufferLayoutDescriptor
                ]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [colorState]
            },
            primitive: {
                topology: 'triangle-strip',
                frontFace: 'ccw',
                cullMode: 'none'
            },
            ...(depthFormat ? {
                depthStencil: {
                    format: depthFormat,
                    depthWriteEnabled: false,
                    depthCompare: 'less-equal'
                }
            } : {})
        })
        
        
        this._renderPipeline = renderPipeline;
        this._numVertices = vertices.length;
        this._splatBindGroup = splatBindGroup;
        this._splatPositionBuffer = splatPosBuffer;
        this._splatIdsBuffer = splatIdsBuffer;
        this._splats = vertices;
        this._cov3dBuffer = cov3dBuffer;
    }

    public updateSplatIndexBuffer(device: GPUDevice, projectionMatrix: Mat4, modelViewMatrix: Mat4, commandEncoder: GPUCommandEncoder) {
          const distances = new Float32Array(this._splats.length);
          
          // Extract the Z row of the modelViewMatrix (m20, m21, m22, m23)
          // In column-major memory: m[2], m[6], m[10], m[14]
          const m20 = modelViewMatrix[2];
          const m21 = modelViewMatrix[6];
          const m22 = modelViewMatrix[10];
          const m23 = modelViewMatrix[14];

          // compute each splats' view-space Z
          for (let i = 0; i < this._splats.length; ++i) {
            const pos = this._splats[i].position;
            // viewPos.z = pos.x * m20 + pos.y * m21 + pos.z * m22 + m23
            distances[i] = pos[0] * m20 + pos[1] * m21 + pos[2] * m22 + m23;
          }
          
          // Create array of indices and sort them based on distances
          const indices = new Uint32Array(distances.length);
          for (let i = 0; i < indices.length; i++) indices[i] = i;
          
          // Sort ascending (most negative Z first = furthest away) for back-to-front rendering
          indices.sort((a, b) => distances[a] - distances[b]); 
  
          const indexUpdateBuffer = device.createBuffer({
            size: indices.length * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true
          });
          new Uint32Array(indexUpdateBuffer.getMappedRange()).set(indices);
          indexUpdateBuffer.unmap();
  
          commandEncoder.copyBufferToBuffer(
              indexUpdateBuffer, // src
              0,
              this._splatIdsBuffer, // dst
              0,
              indices.length * Uint32Array.BYTES_PER_ELEMENT
          );
  
          return indexUpdateBuffer;
    }

    public render(renderPass: GPURenderPassEncoder, viewParamsBindGroup: GPUBindGroup) {
        renderPass.setPipeline(this._renderPipeline);
        renderPass.setBindGroup(0, viewParamsBindGroup);
        renderPass.setBindGroup(1, this._splatBindGroup);
        renderPass.setVertexBuffer(0, this._splatPositionBuffer);
        renderPass.setVertexBuffer(1, this._splatIdsBuffer);
        // Draw all splats in a single instanced draw call
        renderPass.draw(4, this._numVertices, 0, 0);
    }
}
