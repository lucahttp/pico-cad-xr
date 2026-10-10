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

    // Default Materials
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
        opacity: 0.4,
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

  createPrimitive(type, position = new THREE.Vector3(0, 0.12, 0), isHole = false) {
    let geometry;
    const defaultSize = 0.2; // 20 cm in VR scale (ergonomic table/passthrough scale)

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
        // Custom wedge / ramp geometry
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
      case 'torus':
        geometry = new THREE.TorusGeometry(defaultSize / 2, defaultSize / 6, 16, 32);
        break;
      default:
        geometry = new THREE.BoxGeometry(defaultSize, defaultSize, defaultSize);
    }

    const material = isHole ? this.materials.hole.clone() : this.materials.solid.clone();
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
      originalColor: isHole ? null : 0x2563eb
    };

    // Edge wireframe helper for crisp CAD look
    this._attachEdgeHelper(brush);

    this.scene.add(brush);
    this.objects.push(brush);
    return brush;
  }

  _attachEdgeHelper(mesh) {
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
      mesh.material = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.35,
        metalness: 0.15
      });
    }

    const edge = mesh.getObjectByName('cad_edges');
    if (edge) {
      edge.material.color.setHex(mesh.userData.isHole ? 0x64748b : 0x1e3a8a);
    }
  }

  setColor(mesh, hexColor) {
    if (!mesh || !mesh.userData) return;
    mesh.userData.originalColor = hexColor;
    if (!mesh.userData.isHole) {
      mesh.material.color.set(hexColor);
    }
  }

  groupSelected() {
    const targets = Array.from(this.selectedObjects);
    if (targets.length < 2) return null;

    // Separate solids and holes
    const solids = targets.filter(obj => !obj.userData.isHole);
    const holes = targets.filter(obj => obj.userData.isHole);

    if (solids.length === 0) {
      // Cannot group only holes
      return null;
    }

    // Update matrices
    targets.forEach(t => t.updateMatrixWorld(true));

    let accumulator = solids[0];
    const initialSolids = solids.slice(1);

    // 1. Unify all solids
    for (const solid of initialSolids) {
      try {
        const next = this.evaluator.evaluate(accumulator, solid, ADDITION);
        accumulator = next;
      } catch (err) {
        console.warn('Union error:', err);
      }
    }

    // 2. Subtract all holes
    for (const hole of holes) {
      try {
        const next = this.evaluator.evaluate(accumulator, hole, SUBTRACTION);
        accumulator = next;
      } catch (err) {
        console.warn('Subtraction error:', err);
      }
    }

    // Create resulting CSG Brush
    const resultBrush = new Brush(accumulator.geometry, this.materials.solid.clone());
    resultBrush.castShadow = true;
    resultBrush.receiveShadow = true;
    resultBrush.userData = {
      isCadObject: true,
      cadType: 'composite',
      isHole: false,
      id: 'cad_' + Math.random().toString(36).substring(2, 9),
      originalColor: solids[0].userData.originalColor || 0x2563eb
    };
    this._attachEdgeHelper(resultBrush);

    // Remove old targets from scene and registry
    targets.forEach(t => {
      this.removeObject(t);
    });

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
