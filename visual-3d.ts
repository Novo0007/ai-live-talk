/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private mesh!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);

  // Video processing properties
  private videoCanvas!: HTMLCanvasElement;
  private videoCanvasCtx!: CanvasRenderingContext2D;
  private lastVideoFrame!: ImageData;
  private motion = 0;
  private avgColor = new THREE.Vector3();

  @property({attribute: false}) videoElement: HTMLVideoElement | null = null;

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated;
    }
  `;

  protected updated(changedProperties: Map<string | number | symbol, unknown>) {
    if (changedProperties.has('videoElement') && this.videoElement) {
      this.setupVideoProcessing();
    }
  }

  private setupVideoProcessing() {
    if (!this.videoElement) return;
    this.videoCanvas = document.createElement('canvas');
    this.videoCanvas.width = 64; // Small canvas for performance
    this.videoCanvas.height = 48;
    this.videoCanvasCtx = this.videoCanvas.getContext('2d', {
      willReadFrequently: true,
    })!;
  }

  private processVideoFrame() {
    // Draw video to canvas
    this.videoCanvasCtx.drawImage(
      this.videoElement!,
      0,
      0,
      this.videoCanvas.width,
      this.videoCanvas.height,
    );
    const frameData = this.videoCanvasCtx.getImageData(
      0,
      0,
      this.videoCanvas.width,
      this.videoCanvas.height,
    );
    const pixels = frameData.data;

    if (!this.lastVideoFrame) {
      // Store first frame
      this.lastVideoFrame = frameData;
      return;
    }

    let motion = 0;
    let r = 0,
      g = 0,
      b = 0;
    const numPixels = pixels.length / 4;

    for (let i = 0; i < pixels.length; i += 4) {
      // Calculate average color
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];

      // Calculate motion (simple frame differencing)
      const diff =
        Math.abs(pixels[i] - this.lastVideoFrame.data[i]) +
        Math.abs(pixels[i + 1] - this.lastVideoFrame.data[i + 1]) +
        Math.abs(pixels[i + 2] - this.lastVideoFrame.data[i + 2]);
      motion += diff;
    }

    // Normalize values
    this.avgColor.set(
      r / numPixels / 255,
      g / numPixels / 255,
      b / numPixels / 255,
    );
    this.motion = motion / (numPixels * 3 * 255); // Normalize motion to be roughly in [0, 1]

    // Store current frame for next comparison
    this.lastVideoFrame = frameData;
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.DodecahedronGeometry(1.5, 2);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      meshMaterial.envMap = exrCubeRenderTarget.texture;
      mesh.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const meshMaterial = new THREE.MeshStandardMaterial({
      color: 0x2222ff,
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0x111133,
      emissiveIntensity: 2.0,
    });

    meshMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};
      shader.uniforms.cameraData = {value: new THREE.Vector4()};

      meshMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    const mesh = new THREE.Mesh(geometry, meshMaterial);
    scene.add(mesh);
    mesh.visible = false;

    this.mesh = mesh;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      5,
      0.5,
      0,
    );

    const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    this.composer = composer;

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    if (
      this.videoElement &&
      this.videoElement.readyState >= this.videoElement.HAVE_CURRENT_DATA
    ) {
      this.processVideoFrame();
    }

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60);
    this.prevTime = t;
    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    const meshMaterial = this.mesh.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (meshMaterial.userData.shader) {
      this.mesh.scale.setScalar(
        1 + (0.2 * this.outputAnalyser.data[1]) / 255,
      );

      const f = 0.001;
      this.rotation.x += (dt * f * 0.5 * this.outputAnalyser.data[1]) / 255;
      this.rotation.z += (dt * f * 0.5 * this.inputAnalyser.data[1]) / 255;
      this.rotation.y += (dt * f * 0.25 * this.inputAnalyser.data[2]) / 255;
      this.rotation.y += (dt * f * 0.25 * this.outputAnalyser.data[2]) / 255;

      const euler = new THREE.Euler(
        this.rotation.x,
        this.rotation.y,
        this.rotation.z,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      const vector = new THREE.Vector3(0, 0, 5);
      vector.applyQuaternion(quaternion);
      this.camera.position.copy(vector);
      this.camera.lookAt(this.mesh.position);

      meshMaterial.userData.shader.uniforms.time.value +=
        (dt * 0.1 * this.outputAnalyser.data[0]) / 255;
      meshMaterial.userData.shader.uniforms.inputData.value.set(
        (1 * this.inputAnalyser.data[0]) / 255,
        (0.1 * this.inputAnalyser.data[1]) / 255,
        (10 * this.inputAnalyser.data[2]) / 255,
        0,
      );
      meshMaterial.userData.shader.uniforms.outputData.value.set(
        (2 * this.outputAnalyser.data[0]) / 255,
        (0.1 * this.outputAnalyser.data[1]) / 255,
        (10 * this.outputAnalyser.data[2]) / 255,
        0,
      );
      meshMaterial.userData.shader.uniforms.cameraData.value.set(
        this.motion,
        this.avgColor.x,
        this.avgColor.y,
        this.avgColor.z,
      );
    }

    this.composer.render();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}