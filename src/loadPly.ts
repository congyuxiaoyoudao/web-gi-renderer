import type { Vec3, Vec4, Mat3, Mat4 } from 'wgpu-matrix'
import { mat3, mat4, vec2, vec3, vec4, quat} from 'wgpu-matrix'

export class Gaussian{
    private _position : Vec3;
    private _rotation : Vec4;
    private _scale    : Vec3;
    private _color    : Vec3;
    private _opacity  : number;
    private _covariance3d : Mat3;
    private _basis2d : Vec4;

    constructor(position: Vec3, rotation: Vec4, scale: Vec3, color: Vec3, opacity: number){
        this._position = position;
        this._rotation = rotation;
        this._scale = scale;
        this._color = color;
        this._opacity = opacity;

        const quaternion = quat.create(rotation[1], rotation[2], rotation[3], rotation[0]);
        quat.normalize(quaternion, quaternion);
        const rotationMat4 = mat4.fromQuat(quaternion);
        const rotationMat3 = mat3.fromMat4(rotationMat4); 

        const scaleMat4 = mat4.scaling(scale);
        const scaleMat3 = mat3.fromMat4(scaleMat4);

        // compute covariance by R S ST RT
        const T = mat3.multiply(rotationMat3, scaleMat3);
        const T_T = mat3.transpose(T);
        const covarianceMat3 = mat3.multiply(T, T_T);

        this._covariance3d = covarianceMat3;
        this._basis2d = vec4.create(1, -1, 1, 1);
 
    }
    public updateBasis(projectionMatrix: Mat4, modelViewMatrix: Mat4, canvas: HTMLCanvasElement) {
        const renderDimension = { x: canvas.clientWidth, y: canvas.clientHeight };
        const focal = {
            x: projectionMatrix[0] * renderDimension.x * 0.5,
            y: projectionMatrix[5] * renderDimension.y * 0.5
        }

        const viewCenter = vec4.transformMat4(vec4.fromValues(this._position[0], this._position[1], this._position[2], 1.0), modelViewMatrix);
        const s = 1.0 / (viewCenter[2] * viewCenter[2]);

        const J = mat3.create(
            -focal.x / viewCenter[2], 0, (focal.x * viewCenter[0]) * s,
            0, -focal.y / viewCenter[2], (focal.y * viewCenter[1]) * s,
            0, 0, 0
        );

        const W = mat3.transpose(mat3.fromMat4(modelViewMatrix));
        const T = mat3.multiply(W, J);

        const newC = mat3.multiply(mat3.transpose(T), mat3.multiply(this._covariance3d, T));
        
        // F**K here in wgpu-matrix mat3 are padded to 12 numbers
        // c_xx, c_xy, 0, 0
        // c_yx, c_yy, 0, 0
        // ...   ...   ... ...
        const c_xx = newC[0];
        const c_xy = newC[1];
        const c_yy = newC[5];

        // compute eigen values
        const D = c_xx * c_yy - c_xy * c_xy;
        const trace = c_xx + c_yy;
        const traceOver2 = trace / 2;
        const term2 = Math.sqrt(traceOver2 * traceOver2 - D);
        const lambda_1 = traceOver2 + term2;
        const lambda_2 = Math.max(traceOver2 - term2, 0);

        // compute eigen vector
        const maxSplatRadius = 1024;
        const eigenVector_1 = vec2.normalize(vec2.fromValues(c_xy, lambda_1 - c_xx));
        const eigenVector_2 = vec2.fromValues(eigenVector_1[1], -eigenVector_1[0]);

        const basisVector1 = vec2.scale(eigenVector_1, Math.min(Math.sqrt(lambda_1) * 4, maxSplatRadius));
        const basisVector2 = vec2.scale(eigenVector_2, Math.min(Math.sqrt(lambda_2) * 4, maxSplatRadius));

        this._basis2d = vec4.fromValues(basisVector1[0], basisVector1[1], basisVector2[0], basisVector2[1]);
    }

    // -------- GETTER ------------ //
    get position(){ return this._position;}
    get rotation(){ return this._rotation;}
    get scale(){ return this._scale;}
    get color(){ return this._color;}
    get opacity(){ return this._opacity;}
    get basis(){ return this._basis2d;}
    get cov3d() {
        return [
            this._covariance3d[0], // c_xx
            this._covariance3d[1], // c_xy
            this._covariance3d[2], // c_xz
            this._covariance3d[5], // c_yy
            this._covariance3d[6], // c_yz
            this._covariance3d[10], // c_zz
            0, 0 // padding
        ];
    }
}

export class PlyLoader {
    private header: string[] = [];
    private format: string = '';
    private numVertices: number = 0;
    private properties: { name: string; type: string }[] = [];
    private headerLength: number = 0;
    private rawVertices: any[] = [];
    private splattifiedVertices: Gaussian[] = [];
    
    async loadPlyFile(file: File) {
        const buffer = await file.arrayBuffer();
        const decoder = new TextDecoder();
        let headerText = '';
        const chunk = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength)); // 2048 is probably enough to get the end header
        
        // Find the end of the header first
        headerText = decoder.decode(chunk);
        const headerEndIndex = headerText.indexOf('end_header\n');
        if (headerEndIndex === -1) {
            throw new Error('Invalid PLY file: Cannot find end of header');
        }
        this.headerLength = headerEndIndex + 11; // 11 is length of 'end_header\n'
        
        // Parse header
        const headerLines = headerText.slice(0, headerEndIndex).split('\n').map(line => line.trim());
        let i = 0;
        if (headerLines[i] !== 'ply') {
            throw new Error('Invalid PLY file: Missing "ply" header');
        }
        
        i++;
        while (i < headerLines.length) {
            const line = headerLines[i];
            this.header.push(line);
            
            if (line.startsWith('format')) {
                // format ascii or binary_little_endian
                this.format = line.split(' ')[1];
            } else if (line.startsWith('element vertex')) {
                this.numVertices = parseInt(line.split(' ')[2]);
            } else if (line.startsWith('comment')){
                console.log('CommentLine', line);
            } else if (line.startsWith('property')) {
                const parts = line.split(' ');
                this.properties.push({
                    name: parts[2],
                    type: parts[1]
                });
            }
            i++;
        }

        // Parse vertex data based on format
        if (this.format === 'binary_little_endian') {
            this.rawVertices = this.parseBinary(buffer);
        } else if (this.format === 'ascii'){
            this.rawVertices = this.parseASCII(buffer, headerEndIndex);
        } else {
            throw new Error(`Unsupported PLY format: ${this.format}`);
        }

        this.splattifiedVertices = this.splatifyVertices(this.rawVertices);
    }
    private parseBinary(buffer: ArrayBuffer): any[] {
        const dataView = new DataView(buffer);
        const vertices: any[] = [];
        let offset = this.headerLength;

        for (let v = 0; v < this.numVertices; v++) {
            const vertex: any = {};
            
            for (const prop of this.properties) {
                const value = this.readBinaryValue(dataView, offset, prop.type);
                vertex[prop.name] = value;
                offset += this.getTypeSize(prop.type);
            }
            
            vertices.push(vertex);
        }

        return vertices;
    }
    private parseASCII(buffer: ArrayBuffer, headerEndIndex: number): any[] {
        const decoder = new TextDecoder();
        const text = decoder.decode(buffer.slice(headerEndIndex));
        const lines = text.trim().split('\n');

        const vertices: any[] = [];

        for (let v = 0; v < this.numVertices; v++) {
            const vertex: any = {};
            const tokens = lines[v].split(/\s+/);
            for (let j = 0; j < this.properties.length; j++) {
                vertex[this.properties[j].name] = parseFloat(tokens[j]);
            }
            vertices.push(vertex);
        }

        return vertices;
    }
    private splatifyVertices(vertices: any[]) {
        const SH_C0 = 0.28209479177387814;
        const splattedVertices: Gaussian[] = [];

        for (const vertex of vertices) {
            const position = new Float32Array([vertex.x, vertex.y, vertex.z])
            const rotation = vec4.create(vertex.rot_0, vertex.rot_1, vertex.rot_2, vertex.rot_3);
            const scale = vec4.create(Math.exp(vertex.scale_0),
                    Math.exp(vertex.scale_1),
                    Math.exp(vertex.scale_2));
            const color = vec3.create(0.5 + SH_C0 * vertex.f_dc_0,
                    0.5 + SH_C0 * vertex.f_dc_1,
                    0.5 + SH_C0 * vertex.f_dc_2)
            const opacity = 1.0 / (1.0 + Math.exp(-vertex.opacity));
            const splattedVertex = new Gaussian(position, rotation, scale, color, opacity);
            
            splattedVertices.push(splattedVertex);
        }

        return splattedVertices;
    }

    
    private readBinaryValue(dataView: DataView, offset: number, type: string): number {
        switch (type) {
            case 'float':
            case 'float32':
                return dataView.getFloat32(offset, true);
            case 'float64':
            case 'double':
                return dataView.getFloat64(offset, true);
            case 'int8':
                return dataView.getInt8(offset);
            case 'uint8':
                return dataView.getUint8(offset);
            case 'int16':
                return dataView.getInt16(offset, true);
            case 'uint16':
                return dataView.getUint16(offset, true);
            case 'int32':
                return dataView.getInt32(offset, true);
            case 'uint32':
                return dataView.getUint32(offset, true);
            default:
                throw new Error(`Unsupported binary type: ${type}`);
        }
    }

    private getTypeSize(type: string): number {
        switch (type) {
            case 'int8':
            case 'uint8':
                return 1;
            case 'int16':
            case 'uint16':
                return 2;
            case 'int32':
            case 'uint32':
            case 'float':
            case 'float32':
                return 4;
            case 'float64':
            case 'double':
                return 8;
            default:
                throw new Error(`Unknown type size for: ${type}`);
        }
    }
    
    getSplattifiedVertices(): Gaussian[] {
        return this.splattifiedVertices;
    }
}
