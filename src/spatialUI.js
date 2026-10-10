import * as THREE from 'three';

export class SpatialUI {
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.buttons = [];
    this.container = new THREE.Group();
    this.container.name = 'spatial_ui_container';

    // Position floating panel on user's left front in VR
    this.container.position.set(-0.65, 1.15, -0.65);
    this.container.rotation.y = Math.PI / 4.5;

    this.scene.add(this.container);
    this._buildPanel();
  }

  _createButtonTexture(label, bgColor = '#1e293b', textColor = '#f8fafc', sublabel = '') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background rounded rectangle
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 120, 16);
    ctx.fill();

    // Border
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Text
    ctx.fillStyle = textColor;
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, sublabel ? 52 : 64);

    if (sublabel) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '18px sans-serif';
      ctx.fillText(sublabel, 128, 90);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  _addButton(x, y, w, h, label, sublabel, action, bgColor = '#0f172a') {
    const geom = new THREE.BoxGeometry(w, h, 0.02);
    const texture = this._createButtonTexture(label, bgColor, '#f8fafc', sublabel);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.4,
      metalness: 0.1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, 0.015);
    mesh.userData = {
      isSpatialButton: true,
      action: action,
      label: label,
      origZ: 0.015
    };

    this.container.add(mesh);
    this.buttons.push(mesh);
    return mesh;
  }

  _buildPanel() {
    // Backing holographic frame (expanded to accommodate transform row)
    const frameGeom = new THREE.BoxGeometry(0.58, 0.84, 0.01);
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: 0x090d16,
      transparent: true,
      opacity: 0.88,
      roughness: 0.2,
      metalness: 0.5,
      clearcoat: 0.8
    });
    const frame = new THREE.Mesh(frameGeom, frameMat);
    this.container.add(frame);

    // Title banner
    const titleTex = this._createButtonTexture('PICO CAD MR', '#0284c7', '#ffffff', 'SketchForge Spatial Edition');
    const titleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.09, 0.015),
      new THREE.MeshStandardMaterial({ map: titleTex })
    );
    titleMesh.position.set(0, 0.33, 0.012);
    this.container.add(titleMesh);

    // Primitives section (Row 1 & 2)
    const bw = 0.155;
    const bh = 0.075;
    this._addButton(-0.17, 0.22, bw, bh, '+ Cubo', '', () => this.callbacks.addPrimitive('box'), '#1e293b');
    this._addButton(0, 0.22, bw, bh, '+ Cilindro', '', () => this.callbacks.addPrimitive('cylinder'), '#1e293b');
    this._addButton(0.17, 0.22, bw, bh, '+ Esfera', '', () => this.callbacks.addPrimitive('sphere'), '#1e293b');

    this._addButton(-0.17, 0.13, bw, bh, '+ Cono', '', () => this.callbacks.addPrimitive('cone'), '#1e293b');
    this._addButton(0, 0.13, bw, bh, '+ Cuña', '', () => this.callbacks.addPrimitive('wedge'), '#1e293b');
    this._addButton(0.17, 0.13, bw, bh, '+ Torus', '', () => this.callbacks.addPrimitive('torus'), '#1e293b');

    // Transform Row (SketchForge direct scaling controls)
    this._addButton(
      -0.14, 0.03, 0.22, 0.075,
      'Escalar +', '+20% tamaño',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(1.2),
      '#1e293b'
    );
    this._addButton(
      0.14, 0.03, 0.22, 0.075,
      'Escalar -', '-20% tamaño',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(0.8),
      '#1e293b'
    );

    // Solid vs Hole Toggle
    this.holeBtn = this._addButton(
      -0.12, -0.07, 0.25, 0.08,
      'Sólido / Hueco', 'Alternar corte',
      () => this.callbacks.toggleHole(),
      '#334155'
    );

    // Group (Boolean CSG)
    this._addButton(
      0.14, -0.07, 0.22, 0.08,
      '⚡ Agrupar', 'Unión / Corte CSG',
      () => this.callbacks.group(),
      '#166534' // Forest green
    );

    // Utility row: Duplicate, Delete
    this._addButton(
      -0.14, -0.17, 0.22, 0.075,
      'Duplicar', '',
      () => this.callbacks.duplicate(),
      '#1e293b'
    );
    this._addButton(
      0.14, -0.17, 0.22, 0.075,
      'Eliminar', '',
      () => this.callbacks.delete(),
      '#991b1b' // Dark red
    );

    // Bottom row: Export STL & Clear
    this._addButton(
      -0.12, -0.27, 0.24, 0.075,
      'Exportar STL', '',
      () => this.callbacks.exportSTL(),
      '#0369a1'
    );
    this._addButton(
      0.14, -0.27, 0.22, 0.075,
      'Limpiar Todo', '',
      () => this.callbacks.clear(),
      '#374151'
    );
  }

  handleRayIntersection(intersects) {
    for (const hit of intersects) {
      if (hit.object && hit.object.userData && hit.object.userData.isSpatialButton) {
        return hit.object;
      }
    }
    return null;
  }

  triggerButton(btn) {
    if (!btn || !btn.userData || !btn.userData.action) return;

    // Tactical tactile animation: push back then restore
    btn.position.z = btn.userData.origZ - 0.01;
    setTimeout(() => {
      btn.position.z = btn.userData.origZ;
    }, 150);

    btn.userData.action();
  }
}
