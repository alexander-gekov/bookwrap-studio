"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type BookPreview3DProps = {
  frontUrl: string;
  wrapUrl: string;
  trimWidth: number;
  trimHeight: number;
  spineWidth: number;
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function textureFromCrop(image: HTMLImageElement, x: number, width: number) {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1200 / image.height);
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, x, 0, width, image.height, 0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function coverMaterial(color: number, map?: THREE.Texture | null) {
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : color,
    map: map || null,
    roughness: 0.55,
    metalness: 0.04,
  });
}

export function BookPreview3D({
  frontUrl,
  wrapUrl,
  trimWidth,
  trimHeight,
  spineWidth,
}: BookPreview3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;
    const textures: THREE.Texture[] = [];
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(4.6, 2.8, 5.8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      if (hintRef.current) {
        hintRef.current.className = "three-book-error";
        hintRef.current.textContent = "3D preview is unavailable in this browser.";
      }
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label", "Interactive 3D book. Drag to rotate and pinch or scroll to zoom.");
    mount.appendChild(renderer.domElement);

    const safeHeight = Math.max(trimHeight, 0.01);
    const bookHeight = 3;
    const bookWidth = THREE.MathUtils.clamp(bookHeight * (trimWidth / safeHeight), 1.35, 2.55);
    const bookDepth = THREE.MathUtils.clamp(bookHeight * (spineWidth / safeHeight), 0.12, 0.52);
    const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f0e4, roughness: 0.92 });
    const frontMaterial = coverMaterial(0x24324a);
    const backMaterial = coverMaterial(0x1a2638);
    const spineMaterial = coverMaterial(0x111922);
    const materials = [pageMaterial, spineMaterial, pageMaterial, pageMaterial, frontMaterial, backMaterial];
    const geometry = new THREE.BoxGeometry(bookWidth, bookHeight, bookDepth, 2, 2, 2);
    const book = new THREE.Mesh(geometry, materials);
    book.castShadow = true;
    book.receiveShadow = true;
    scene.add(book);

    const floorMaterial = new THREE.ShadowMaterial({ color: 0x102433, opacity: 0.17 });
    const floorGeometry = new THREE.PlaneGeometry(12, 12);
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -bookHeight / 2 - 0.28;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dde2, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
    keyLight.position.set(4, 7, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.6);
    rimLight.position.set(-5, 2, -4);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 10;
    controls.target.set(0, 0, 0);
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.8;
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotateSpeed = 0.9;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const applyTexture = (material: THREE.MeshStandardMaterial, texture: THREE.Texture | null) => {
      if (!texture || disposed) return;
      textures.push(texture);
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    };

    if (frontUrl) {
      void loadImage(frontUrl)
        .then((image) => applyTexture(frontMaterial, textureFromCrop(image, 0, image.width)))
        .catch(() => undefined);
    }

    if (wrapUrl) {
      void loadImage(wrapUrl)
        .then((image) => {
          const total = Math.max(trimWidth * 2 + spineWidth, 0.01);
          const backWidth = image.width * (trimWidth / total);
          const mappedSpineWidth = image.width * (spineWidth / total);
          applyTexture(backMaterial, textureFromCrop(image, 0, backWidth));
          applyTexture(spineMaterial, textureFromCrop(image, backWidth, mappedSpineWidth));
        })
        .catch(() => undefined);
    }

    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      geometry.dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [frontUrl, spineWidth, trimHeight, trimWidth, wrapUrl]);

  return (
    <div className="three-book-shell">
      <div ref={mountRef} className="three-book-canvas" />
      <p ref={hintRef} className="three-book-hint">Drag to rotate · Pinch or scroll to zoom</p>
    </div>
  );
}
