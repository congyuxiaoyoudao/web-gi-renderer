import { GaussianBuffers } from './loadPly';
import type { Mat4 } from 'wgpu-matrix'
import splat_shader from './splat_shader';
import sort_shader from './bitonic_shader';

export class Splats {
    private _renderPipeline: GPURenderPipeline;
    private _numVertices: number;
    private _splatBindGroup: GPUBindGroup;
    private _splatPositionBuffer: GPUBuffer;
    private _splatIdsBuffer: GPUBuffer;
    private _cov3dBuffer: GPUBuffer;
    private _positionsBuffer: Float32Array;
    public maxSHDegree: number = 0;

    // GPU Compute resources for sorting
    private _computeDistancesPipeline!: GPUComputePipeline;
    private _bitonicSortPipeline!: GPUComputePipeline;
    private _sortUniformsBuffer!: GPUBuffer;
    private _sortStepUniformsBuffer!: GPUBuffer;
    private _sortBindGroup0!: GPUBindGroup;
    private _sortBindGroup1!: GPUBindGroup;
    private _numPasses!: number;
    private _paddedVertices!: number;

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
                },
                {
                    binding: 3,
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

        // Tight-packed f32 array: 15 higher-order basis × 3 channels = 45 floats per splat.
        const shCoeffsBuffer = device.createBuffer({
            size: 45 * Float32Array.BYTES_PER_ELEMENT * vertices.count,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(shCoeffsBuffer, 0, vertices.shCoeffs.buffer);

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
                },
                {
                    binding: 3,
                    resource: {buffer: shCoeffsBuffer},
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

        this._numVertices = vertices.count;
        this._paddedVertices = Math.max(2, Math.pow(2, Math.ceil(Math.log2(this._numVertices))));

        const splatIdsBuffer = device.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT * this._paddedVertices,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
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
        this.maxSHDegree = vertices.maxSHDegree;

        // --- Compute Pipelines for Sorting ---
        const sortShaderModule = device.createShaderModule({
            code: sort_shader
        });

        const distancesBuffer = device.createBuffer({
            size: this._paddedVertices * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this._sortUniformsBuffer = device.createBuffer({
            size: 80, // 16 * 4 (mat4) + 2 * 4 (uints) + 8 (padding) = 80 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this._numPasses = (Math.log2(this._paddedVertices) * (Math.log2(this._paddedVertices) + 1)) / 2;
        this._sortStepUniformsBuffer = device.createBuffer({
            size: Math.max(256, this._numPasses * 256), // 256 bytes alignment per dynamic offset
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Pre-calculate all j, k pairs for the bitonic sort passes
        const sortStepData = new ArrayBuffer(Math.max(256, this._numPasses * 256));
        const sortStepView = new DataView(sortStepData);
        let passIdx = 0;
        for (let k = 2; k <= this._paddedVertices; k *= 2) {
            for (let j = k / 2; j >= 1; j = Math.floor(j / 2)) {
                sortStepView.setUint32(passIdx * 256, j, true);
                sortStepView.setUint32(passIdx * 256 + 4, k, true);
                passIdx++;
            }
        }
        device.queue.writeBuffer(this._sortStepUniformsBuffer, 0, sortStepData);

        const sortBindGroupLayout0 = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ]
        });

        const sortBindGroupLayout1 = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
            ]
        });

        this._computeDistancesPipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [sortBindGroupLayout0]
            }),
            compute: {
                module: sortShaderModule,
                entryPoint: 'compute_distances',
            },
        });

        this._bitonicSortPipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [sortBindGroupLayout0, sortBindGroupLayout1]
            }),
            compute: {
                module: sortShaderModule,
                entryPoint: 'bitonic_sort',
            },
        });

        this._sortBindGroup0 = device.createBindGroup({
            layout: sortBindGroupLayout0,
            entries: [
                { binding: 0, resource: { buffer: this._sortUniformsBuffer } },
                { binding: 1, resource: { buffer: positionsBuffer } },
                { binding: 2, resource: { buffer: distancesBuffer } },
                { binding: 3, resource: { buffer: splatIdsBuffer } },
            ],
        });

        this._sortBindGroup1 = device.createBindGroup({
            layout: sortBindGroupLayout1,
            entries: [
                { binding: 0, resource: { buffer: this._sortStepUniformsBuffer, size: 8 } },
            ],
        });
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

    public updateSplatIndexBufferGPU(device: GPUDevice, modelViewMatrix: Mat4, commandEncoder: GPUCommandEncoder) {
        // Update uniforms for compute distances
        const uniformsData = new ArrayBuffer(80);
        const uniformsFloat = new Float32Array(uniformsData, 0, 16);
        const uniformsUint = new Uint32Array(uniformsData, 16 * 4, 2);

        uniformsFloat.set(modelViewMatrix);
        uniformsUint[0] = this._numVertices;
        uniformsUint[1] = this._paddedVertices;

        device.queue.writeBuffer(this._sortUniformsBuffer, 0, uniformsData);

        const computePass = commandEncoder.beginComputePass();
        computePass.setPipeline(this._computeDistancesPipeline);
        computePass.setBindGroup(0, this._sortBindGroup0);
        computePass.dispatchWorkgroups(Math.ceil(this._paddedVertices / 256));
        computePass.setPipeline(this._bitonicSortPipeline);
        
        let passIdx = 0;
        for (let k = 2; k <= this._paddedVertices; k *= 2) {
            for (let j = k / 2; j >= 1; j = Math.floor(j / 2)) {
                computePass.setBindGroup(1, this._sortBindGroup1, [passIdx * 256]);
                computePass.dispatchWorkgroups(Math.ceil(this._paddedVertices / 256));
                passIdx++;
            }
        }

        computePass.end();
    }

    public render(renderPass: GPURenderPassEncoder, viewParamsBindGroup: GPUBindGroup, numSplats?: number) {
        renderPass.setPipeline(this._renderPipeline);
        renderPass.setBindGroup(0, viewParamsBindGroup);
        renderPass.setBindGroup(1, this._splatBindGroup);
        renderPass.setVertexBuffer(0, this._splatPositionBuffer);
        renderPass.setVertexBuffer(1, this._splatIdsBuffer);
        const count = numSplats !== undefined ? numSplats : this._numVertices;
        renderPass.draw(4, count, 0, 0);
    }
}
