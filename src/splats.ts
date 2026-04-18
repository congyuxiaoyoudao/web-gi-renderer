import { GaussianBuffers } from './loadPly';
import type { Mat4 } from 'wgpu-matrix'
import splat_shader from './splat_shader';

export class Splats {
    private _renderPipeline: GPURenderPipeline;
    private _numVertices: number;
    private _splatBindGroup: GPUBindGroup;
    private _splatPositionBuffer: GPUBuffer;
    private _splatIdsBuffer: GPUBuffer;
    private _cov3dBuffer: GPUBuffer;
    private _positionsBuffer: Float32Array;

    constructor(
        device: GPUDevice,
        vertices: GaussianBuffers,
        viewParamsBindGroupLayout: GPUBindGroupLayout,
        format: GPUTextureFormat,
        depthFormat: GPUTextureFormat = 'depth32float'
    ) {
        const shaderModule = device.createShaderModule({
            code: splat_shader
        });

        const { positions, cov3d, colors } = vertices;

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

        const positionsBuffer = device.createBuffer({
            size: 4 * Float32Array.BYTES_PER_ELEMENT * vertices.count,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(positionsBuffer, 0, positions.buffer);

        const cov3dBuffer = device.createBuffer({
            size: 8 * Float32Array.BYTES_PER_ELEMENT * vertices.count,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(cov3dBuffer, 0, cov3d.buffer);

        const colorsBuffer = device.createBuffer({
            size: 4 * Float32Array.BYTES_PER_ELEMENT * vertices.count,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(colorsBuffer, 0, colors.buffer);

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
        const splatPosBuffer = device.createBuffer({
            size: 2 * Float32Array.BYTES_PER_ELEMENT * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(splatPosBuffer, 0, splatPos.buffer, splatPos.byteOffset, splatPos.byteLength);
        const splatPositionBufferLayoutDescriptor: GPUVertexBufferLayout = {
            arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
            stepMode: 'vertex',
            attributes: [{
                format: 'float32x2',
                offset: 0,
                shaderLocation: 0
            }]
        };

        const splatIds = new Uint32Array(vertices.count).fill(0).map((_, i) => i);
        const splatIdsBuffer = device.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT * vertices.count,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(splatIdsBuffer, 0, splatIds.buffer, splatIds.byteOffset, splatIds.byteLength);

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
                    srcFactor: 'one',
                    dstFactor: 'one-minus-src-alpha',
                }
            }
        };

        // Build bind group layouts array for pipeline
        const bindGroupLayouts = [viewParamsBindGroupLayout, splatBindGroupLayout];

        const renderPipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: bindGroupLayouts
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
            // Use hardware depth testing against pre-rendered scene depth
            // disable depthWrite because we only read depth, not write
            depthStencil: {
                depthWriteEnabled: false,
                depthCompare: 'less-equal',
                format: depthFormat
            }
        });

        this._renderPipeline = renderPipeline;
        this._numVertices = vertices.count;
        this._splatBindGroup = splatBindGroup;
        this._splatPositionBuffer = splatPosBuffer;
        this._splatIdsBuffer = splatIdsBuffer;
        this._positionsBuffer = positions;
        this._cov3dBuffer = cov3dBuffer;
    }

    public updateSplatIndexBuffer(device: GPUDevice, projectionMatrix: Mat4, modelViewMatrix: Mat4, commandEncoder: GPUCommandEncoder) {
        // Calculate depth sorting on CPU (back-to-front for alpha blending)
        const distances = new Float32Array(this._numVertices);
        const visibleIndices: number[] = [];

        // Extract view-space Z row from modelViewMatrix
        const m20 = modelViewMatrix[2];
        const m21 = modelViewMatrix[6];
        const m22 = modelViewMatrix[10];
        const m23 = modelViewMatrix[14];

        // Compute view-space Z for each splat and perform frustum culling
        for (let i = 0; i < this._numVertices; ++i) {
            const baseIdx = i * 4;
            const x = this._positionsBuffer[baseIdx + 0];
            const y = this._positionsBuffer[baseIdx + 1];
            const z = this._positionsBuffer[baseIdx + 2];

            // Compute view-space Z for culling (optimize by only computing Z)
            const viewZ = x * m20 + y * m21 + z * m22 + m23;

            distances[i] = viewZ;

            // Simple frustum culling: check if point is in front of near plane
            // In view space, camera looks down -Z, so visible points have negative Z
            if (viewZ < 0) {
                visibleIndices.push(i);
            }
        }

        // Generate sorted indices (furthest to nearest) for visible splats only
        const indices = new Uint32Array(visibleIndices.length);
        for (let i = 0; i < visibleIndices.length; i++) {
            indices[i] = visibleIndices[i];
        }

        // Sort by distance (back-to-front)
        indices.sort((a, b) => distances[a] - distances[b]);

        // Update instance buffer directly via queue.writeBuffer
        device.queue.writeBuffer(this._splatIdsBuffer, 0, indices.buffer, indices.byteOffset, indices.byteLength);

        // Return the number of visible splats for rendering
        return visibleIndices.length;
    }

    public render(renderPass: GPURenderPassEncoder, viewParamsBindGroup: GPUBindGroup, numSplats?: number) {
        renderPass.setPipeline(this._renderPipeline);
        renderPass.setBindGroup(0, viewParamsBindGroup);
        renderPass.setBindGroup(1, this._splatBindGroup);
        renderPass.setVertexBuffer(0, this._splatPositionBuffer);
        renderPass.setVertexBuffer(1, this._splatIdsBuffer);
        // Draw visible splats (or all if numSplats not specified)
        const count = numSplats !== undefined ? numSplats : this._numVertices;
        renderPass.draw(4, count, 0, 0);
    }
}
