# Web GI Renderer

基于 **WebGPU** 的混合实时渲染系统，将 **3D Gaussian Splatting** 与传统 PBR 网格渲染融合在同一画布。使用 React 19、Three.js WebGPU Renderer 和 React Three Fiber 构建。

---

## 预览

> 需要支持 WebGPU 的浏览器（Chrome 113+ / Edge 113+）并运行在安全上下文（HTTPS 或 localhost）中。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| 3D Gaussian Splatting | 实时渲染 `.ply` 格式高斯点云，支持视角相关球谐颜色（SH 0–3 阶） |
| 混合深度测试 | 高斯点云与 PBR 网格共享深度缓冲，正确处理相互遮挡 |
| IBL 环境光照 | 立方体贴图驱动的基于图像光照（Image-Based Lighting），随高斯旋转同步 |
| GLB 模型导入 | 上传任意数量 `.glb/.gltf` 文件，每个模型独立材质编辑 |
| 变换 Gizmo | 点击选中物体后出现 TransformControls，支持平移 / 旋转 / 缩放三种模式 |
| 几何体编辑器 | 在场景中添加 Box / Sphere / Cylinder / Cone / Torus，实时编辑颜色、金属度、粗糙度 |
| GPU Bitonic 排序 | 可选 GPU 端深度排序（WGSL Compute Shader），替代 CPU TimSort |
| 相机路径回放 | 导入 COLMAP `cameras.json`，自动插值播放相机漫游动画 |
| 性能基准测试 | 内置 10 秒 FPS + 内存采样基准，输出均值与峰值 |
| 截图导出 | 一键导出当前帧为 PNG |

---

## 技术栈

```
Vite 6 + React 19 + TypeScript
Three.js 0.183 (WebGPU Renderer)
React Three Fiber 9 + React Three Drei 10
Tailwind CSS v4
```

---

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（端口 3000，允许局域网访问）
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview

# TypeScript 类型检查
npm run lint
```

---

## 渲染架构

```
┌──────────────────────────────────────┐
│        Three.js R3F 场景              │
│  PBR 网格 · IBL 环境光照 · 阴影       │
└──────────────────────────────────────┘
              ↓  priority 0
┌──────────────────────────────────────┐
│     WebGPU 原生 3D Gaussian Splat     │
│  协方差投影 · Alpha 混合 · 深度测试   │
└──────────────────────────────────────┘
              ↓  priority 1
           最终合成帧
```

**关键设计**：

- Three.js 先将 PBR 场景渲染至画布，同时将深度写入独立的 `depth32float` RenderTarget
- 高斯渲染 pass 以 `loadOp: "load"` 保留画布内容，以 `depthReadOnly` 挂载深度纹理做只读深度测试
- 环境旋转每帧同步，确保 IBL 始终与高斯坐标系对齐

---

## 项目结构

```
src/
├── App.tsx            # 主应用：Canvas 配置、场景组合、相机路径播放
├── SettingsPanel.tsx  # 右侧控制面板（纯 Tailwind，无第三方 UI 库）
├── WebGPUSplat.tsx    # 高斯渲染 R3F 集成组件
├── splats.ts          # WebGPU 渲染器（Pipeline、BindGroup、排序）
├── splat_shader.ts    # WGSL 顶点 / 片元着色器
├── bitonic_shader.ts  # WGSL GPU Bitonic 排序 Compute Shader
├── loadPly.ts         # PLY 解析器（binary_little_endian / ascii）
├── UploadedModel.tsx  # GLB 多模型管理（useModels hook + ModelsScene）
├── Primitives.tsx     # 几何体管理（usePrimitives hook + PrimitivesScene）
├── colmapCamera.ts    # COLMAP cameras.json → Three.js 相机帧转换
└── Loader.tsx         # 启动加载遮罩
```

---

## 内置高斯场景

| 名称 | 来源 |
|------|------|
| Food | 本地 `public/assets/food.ply` |
| Bicycle | HuggingFace dylanebert/3dgs |
| Bonsai | HuggingFace dylanebert/3dgs |
| Stump | HuggingFace dylanebert/3dgs |
| Custom | 上传本地 `.ply` 文件 |

---

## 控制面板说明

| 区块 | 功能 |
|------|------|
| **Render** | Sort Method（CPU/GPU）、SH Degree（0–3）、Splat Radius、Debug Depth |
| **Scene** | 切换高斯场景、相机预设、默认场景对象开关 |
| **Gaussian Transform** | 高斯点云整体位移 / 旋转（同步 IBL 环境旋转） |
| **Primitives** | 添加 / 删除几何体，切换 Gizmo 模式（translate / rotate / scale） |
| **Material**（选中几何体时） | 基础色、金属度、粗糙度 |
| **Model Material**（选中模型时） | 金属度、粗糙度 Override |
| **Upload** | 上传 Gaussian PLY、添加 GLB 模型、模型列表（点击选中 / × 删除） |
| **Tools** | 截图、相机路径导入 / 清除 / 播放 |

---

## 浏览器兼容性

| 浏览器 | 版本 | WebGPU |
|--------|------|--------|
| Chrome | 113+ | ✅ |
| Edge | 113+ | ✅ |
| Firefox | — | ⚠️ 实验性标志 |
| Safari | 18+ | ⚠️ 部分支持 |


gaussian splatting from

# Test Cases
- [Bonsai 30K](https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_30000/point_cloud.ply)
- [Bicycle 7K](https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bicycle/point_cloud/iteration_7000/point_cloud.ply)
- [Stump 30K](https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/stump/point_cloud/iteration_30000/point_cloud.ply)