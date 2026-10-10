import * as THREE from 'three';

/**
 * Smart Placement & Workplane Engine
 * Inspired by SketchForge-3D algorithms (re-implemented cleanly with zero AGPL contamination)
 */
export class SmartPlacement {
  constructor(gridStep = 0.025, tableLevel = 0.0) {
    this.gridStep = gridStep; // 25 mm snapping
    this.tableLevel = tableLevel;
    this.snapThreshold = 0.06; // 6 cm detection threshold for surface snapping
  }

  /**
   * Quantize a 3D coordinate to the workplane grid
   */
  snapToGrid(position, step = this.gridStep) {
    return new THREE.Vector3(
      Math.round(position.x / step) * step,
      position.y,
      Math.round(position.z / step) * step
    );
  }

  /**
   * Compute bounding box extents and local center offset for an object
   */
  getObjectDimensions(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    return { box, size, halfY: size.y / 2 };
  }

  /**
   * Calculate surface snap position and normal alignment against a target CAD object
   * (transposing placementWorkplane logic to WebXR raycasts)
   */
  calculateSurfaceSnap(hit, grabbedMesh) {
    if (!hit || !hit.point || !hit.face) return null;

    const hitNormal = hit.face.normal.clone();
    hitNormal.transformDirection(hit.object.matrixWorld).normalize();

    // Get current dimensions of grabbed mesh
    const { halfY, size } = this.getObjectDimensions(grabbedMesh);

    // Compute offset so bottom or back of object aligns flush with target face
    // For a normal pointing up (Y = 1): offset by halfY in normal direction
    const offsetDistance = Math.min(size.x, size.y, size.z) * 0.5;
    const snapPos = hit.point.clone().add(hitNormal.clone().multiplyScalar(halfY || offsetDistance));

    return {
      position: snapPos,
      normal: hitNormal
    };
  }

  /**
   * Auto-drop guard to workplane table
   */
  applyTableSnap(position, halfY) {
    const bottomY = position.y - halfY;
    if (Math.abs(bottomY - this.tableLevel) < this.snapThreshold) {
      position.y = this.tableLevel + halfY;
      return true;
    }
    return false;
  }
}
