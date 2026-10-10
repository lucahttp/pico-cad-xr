import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';

export class CSGEngine {
  constructor(scene) {
    this.scene = scene;
    this.evaluator = new Evaluator();
    this.evaluator.useGroups = false;
    this.objects = [];
    this.selectedObjects = new Set();
    this.history = [];

    // Default Materials & Styles
    this.materials = {
      solid: new THREE.MeshStandardMaterial({
        color: 0x2563eb, // Vibrant precision blue
        roughness: 0.35,
        metalness: 0.15
      }),
      solidAccent: new THREE.MeshStandardMaterial({
        color: 0xf97316, // Vibrant orange
        roughness: 0.35,
        metalness: 0.15
      }),
      hole: new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.2,
        metalness: 0.05,
        opacity: 0.38,
        transparent: true,
        depthWrite: false
      }),
      selected: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.3,
        metalness: 0.2,
        emissive: 0x0284c7,
        emissiveIntensity: 0.3
      })
    };
  }

  createPrimitive(type, position = new THREE.Vector3(0, 0.1, 0), isHole = false, customColor = null) {
    let geometry;
    const defaultSize = 0.2; // 20 cm in VR scale (200 mm)

    switch (type) {
      case 'box':
        geometry = new THREE.BoxGeometry(defaultSize, defaultSize, defaultSize);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(defaultSize / 2, defaultSize / 2, defaultSize, 32);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(defaultSize / 2, 32, 24);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(defaultSize / 2, defaultSize, 32);
        break;
      case 'wedge': {
        const shape = new THREE.Shape();
        shape.moveTo(-defaultSize / 2, -defaultSize / 2);
        shape.lineTo(defaultSize / 2, -defaultSize / 2);
        shape.lineTo(-defaultSize / 2, defaultSize / 2);
        shape.closePath();
        const extrudeSettings = { depth: defaultSize, bevelEnabled: false };
        geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();
        break;
      }
      case 'pyramid':
        geometry = new THREE.ConeGeometry(defaultSize / 2, defaultSize, 4);
        geometry.rotateY(Math.PI / 4);
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(defaultSize / 2, defaultSize / 6, 16, 32);
        break;
      case 'tube':
        // Hollow cylinder
        geometry = new THREE.CylinderGeometry(defaultSize / 2, defaultSize / 2, defaultSize, 32, 1, true);
        break;
      case 'roof': {
        // Triangular roof prism
        const shape = new THREE.Shape();
        shape.moveTo(-defaultSize / 2, 0);
        shape.lineTo(defaultSize / 2, 0);
        shape.lineTo(0, defaultSize / 2);
        shape.closePath();
        geometry = new THREE.ExtrudeGeometry(shape, { depth: defaultSize, bevelEnabled: false });
        geometry.center();
        break;
      }
      default:
        geometry = new THREE.BoxGeometry(defaultSize, defaultSize, defaultSize);
    }

    const color = customColor || (isHole ? null : 0x2563eb);
    const material = isHole ? this.materials.hole.clone() : new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.15
    });

    const brush = new Brush(geometry, material);
    brush.position.copy(position);
    brush.castShadow = true;
    brush.receiveShadow = true;

    // Metadata
    brush.userData = {
      isCadObject: true,
      cadType: type,
      isHole: isHole,
      id: 'cad_' + Math.random().toString(36).substring(2, 9),
      originalColor: color,
      materialStyle: 'basic',
      baseDimensions: { x: defaultSize, y: defaultSize, z: defaultSize }
    };

    // Edge wireframe helper for crisp CAD look
    this._attachEdgeHelper(brush);

    this.scene.add(brush);
    this.objects.push(brush);
    return brush;
  }

  _attachEdgeHelper(mesh) {
    const existing = mesh.getObjectByName('cad_edges');
    if (existing) mesh.remove(existing);

    const edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 35);
    const lineMat = new THREE.LineBasicMaterial({
      color: mesh.userData.isHole ? 0x64748b : 0x1e3a8a,
      linewidth: 1
    });
    const edgeLines = new THREE.LineSegments(edgesGeom, lineMat);
    edgeLines.name = 'cad_edges';
    mesh.add(edgeLines);
  }

  toggleHole(mesh) {
    if (!mesh || !mesh.userData) return;
    mesh.userData.isHole = !mesh.userData.isHole;

    if (mesh.userData.isHole) {
      mesh.material = this.materials.hole.clone();
    } else {
      const color = mesh.userData.originalColor || 0x2563eb;
      mesh.material = this.createMaterialForStyle(mesh.userData.materialStyle || 'basic', color);
    }

    const edge = mesh.getObjectByName('cad_edges');
    if (edge) {
      edge.material.color.setHex(mesh.userData.isHole ? 0x64748b : 0x1e3a8a);
    }
  }

  createMaterialForStyle(style, color) {
    switch (style) {
      case 'reflective':
        return new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.1,
          metalness: 0.85
        });
      case 'clay':
        return new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.9,
          metalness: 0.02
        });
      case 'toon':
        return new THREE.MeshToonMaterial({
          color: color
        });
      case 'basic':
      default:
        return new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.35,
          metalness: 0.15
        });
    }
  }

  setColor(mesh, hexColor) {
    if (!mesh || !mesh.userData) return;
    mesh.userData.originalColor = hexColor;
    if (!mesh.userData.isHole) {
      mesh.material.color.set(hexColor);
    }
  }

  setMaterialStyle(mesh, style) {
    if (!mesh || !mesh.userData) return;
    mesh.userData.materialStyle = style;
    if (!mesh.userData.isHole) {
      mesh.material = this.createMaterialForStyle(style, mesh.userData.originalColor || 0x2563eb);
    }
  }

  setObjectDimensions(mesh, { width, height, depth }) {
    if (!mesh || !mesh.userData) return;
    const base = mesh.userData.baseDimensions || { x: 0.2, y: 0.2, z: 0.2 };
    if (width !== undefined && width > 0) mesh.scale.x = width / base.x;
    if (height !== undefined && height > 0) mesh.scale.y = height / base.y;
    if (depth !== undefined && depth > 0) mesh.scale.z = depth / base.z;
    mesh.updateMatrixWorld(true);
  }

  getObjectDimensions(mesh) {
    if (!mesh) return { width: 200, height: 200, depth: 200 };
    const base = mesh.userData?.baseDimensions || { x: 0.2, y: 0.2, z: 0.2 };
    return {
      width: Math.round(mesh.scale.x * base.x * 1000), // in mm
      height: Math.round(mesh.scale.y * base.y * 1000),
      depth: Math.round(mesh.scale.z * base.z * 1000)
    };
  }

  dropToWorkplane(mesh) {
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const bottomY = box.min.y;
    mesh.position.y -= bottomY;
    mesh.updateMatrixWorld(true);
  }

  groupSelected() {
    const targets = Array.from(this.selectedObjects);
    if (targets.length < 2) return null;

    const solids = targets.filter(obj => !obj.userData.isHole);
    const holes = targets.filter(obj => obj.userData.isHole);

    if (solids.length === 0) return null;

    targets.forEach(t => t.updateMatrixWorld(true));

    let accumulator = solids[0];
    const initialSolids = solids.slice(1);

    for (const solid of initialSolids) {
      try {
        const next = this.evaluator.evaluate(accumulator, solid, ADDITION);
        accumulator = next;
      } catch (err) {
        console.warn('CSG Union error:', err);
      }
    }

    for (const hole of holes) {
      try {
        const next = this.evaluator.evaluate(accumulator, hole, SUBTRACTION);
        accumulator = next;
      } catch (err) {
        console.warn('CSG Subtraction error:', err);
      }
    }

    const color = solids[0].userData.originalColor || 0x2563eb;
    const resultBrush = new Brush(accumulator.geometry, new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.15
    }));
    resultBrush.castShadow = true;
    resultBrush.receiveShadow = true;
    resultBrush.userData = {
      isCadObject: true,
      cadType: 'composite',
      isHole: false,
      id: 'cad_' + Math.random().toString(36).substring(2, 9),
      originalColor: color,
      materialStyle: 'basic',
      baseDimensions: { x: 0.2, y: 0.2, z: 0.2 }
    };
    this._attachEdgeHelper(resultBrush);

    targets.forEach(t => this.removeObject(t));

    this.scene.add(resultBrush);
    this.objects.push(resultBrush);
    this.selectedObjects.clear();
    this.selectedObjects.add(resultBrush);

    return resultBrush;
  }

  intersectSelected() {
    const targets = Array.from(this.selectedObjects);
    if (targets.length < 2) return null;

    targets.forEach(t => t.updateMatrixWorld(true));

    let accumulator = targets[0];
    for (let i = 1; i < targets.length; i++) {
      try {
        accumulator = this.evaluator.evaluate(accumulator, targets[i], INTERSECTION);
      } catch (err) {
        console.warn('CSG Intersection error:', err);
      }
    }

    const color = targets[0].userData.originalColor || 0x2563eb;
    const resultBrush = new Brush(accumulator.geometry, new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.35,
      metalness: 0.15
    }));
    resultBrush.castShadow = true;
    resultBrush.receiveShadow = true;
    resultBrush.userData = {
      isCadObject: true,
      cadType: 'intersection',
      isHole: false,
      id: 'cad_' + Math.random().toString(36).substring(2, 9),
      originalColor: color,
      materialStyle: 'basic',
      baseDimensions: { x: 0.2, y: 0.2, z: 0.2 }
    };
    this._attachEdgeHelper(resultBrush);

    targets.forEach(t => this.removeObject(t));

    this.scene.add(resultBrush);
    this.objects.push(resultBrush);
    this.selectedObjects.clear();
    this.selectedObjects.add(resultBrush);

    return resultBrush;
  }

  removeObject(obj) {
    const idx = this.objects.indexOf(obj);
    if (idx !== -1) {
      this.objects.splice(idx, 1);
    }
    this.selectedObjects.delete(obj);
    this.scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
  }

  clearAll() {
    [...this.objects].forEach(o => this.removeObject(o));
  }
}
