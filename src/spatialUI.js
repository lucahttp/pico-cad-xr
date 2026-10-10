import * as THREE from 'three';

export class SpatialUI {
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.buttons = [];
    this.container = new THREE.Group();
    this.container.name = 'spatial_ui_container';

    // Position floating panel on user's left front in VR (ergonomic desk view)
    this.container.position.set(-0.55, 1.15, -0.65);
    this.container.rotation.y = Math.PI / 5.2;

    this.currentTab = 'primitives'; // 'primitives' | 'modify' | 'csg' | 'materials' | 'export'
    this.activeColor = '#2563eb';
    this.activeMaterial = 'basic';
    this.gridSnapEnabled = true;

    this.scene.add(this.container);
    this._rebuildPanel();
  }

  _createTexture(drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    drawFn(ctx, 512, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  _clearButtons() {
    this.buttons.forEach(btn => {
      this.container.remove(btn);
      if (btn.geometry) btn.geometry.dispose();
      if (btn.material) {
        if (btn.material.map) btn.material.map.dispose();
        btn.material.dispose();
      }
    });
    this.buttons = [];

    // Remove old content children
    const toRemove = [];
    this.container.children.forEach(c => {
      if (c.name !== 'base_frame') toRemove.push(c);
    });
    toRemove.forEach(c => this.container.remove(c));
  }

  _addButton(x, y, w, h, label, sublabel, action, options = {}) {
    const geom = new THREE.BoxGeometry(w, h, 0.016);
    const {
      bgColor = '#111827',
      borderColor = options.active ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)',
      textColor = '#f8fafc',
      badge = '',
      colorDot = null
    } = options;

    const texture = this._createTexture((ctx, width, height) => {
      // Background with rounded corners
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(8, 8, width - 16, height - 16, 24);
      ctx.fill();

      // Border glow if active or standard border
      ctx.lineWidth = options.active ? 8 : 4;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      // Color Dot indicator if provided
      if (colorDot) {
        ctx.fillStyle = colorDot;
        ctx.beginPath();
        ctx.arc(60, height / 2, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      // Main Text
      ctx.fillStyle = textColor;
      ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = colorDot ? 'left' : 'center';
      ctx.textBaseline = 'middle';
      const textX = colorDot ? 110 : width / 2;
      const textY = sublabel ? (height / 2 - 20) : (height / 2);
      ctx.fillText(label, textX, textY);

      // Sublabel
      if (sublabel) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '24px sans-serif';
        ctx.fillText(sublabel, textX, height / 2 + 28);
      }

      // Badge
      if (badge) {
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.roundRect(width - 120, 16, 100, 36, 12);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(badge, width - 70, 34);
      }
    });

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.3,
      metalness: 0.1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, 0.016);
    mesh.userData = {
      isSpatialButton: true,
      action: action,
      origZ: 0.016
    };

    this.container.add(mesh);
    this.buttons.push(mesh);
    return mesh;
  }

  _rebuildPanel() {
    this._clearButtons();

    // Base glass frame (Gravity Sketch inspired curved dark glass)
    if (!this.frame) {
      const frameGeom = new THREE.BoxGeometry(0.68, 0.88, 0.012);
      const frameMat = new THREE.MeshPhysicalMaterial({
        color: 0x070b14,
        transparent: true,
        opacity: 0.92,
        roughness: 0.15,
        metalness: 0.6,
        clearcoat: 0.8
      });
      this.frame = new THREE.Mesh(frameGeom, frameMat);
      this.frame.name = 'base_frame';
      this.container.add(this.frame);
    }

    // Top Header Banner
    const bannerTex = this._createTexture((ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#0284c7');
      grad.addColorStop(1, '#6366f1');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 20);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('SketchForge XR', 32, h / 2 - 12);

      ctx.fillStyle = '#e0f2fe';
      ctx.font = '22px sans-serif';
      ctx.fillText('PICO 4 Spatial CAD Studio', 34, h / 2 + 30);

      // Status pill
      ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
      ctx.beginPath();
      ctx.roundRect(w - 180, 24, 150, 48, 24);
      ctx.fill();
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('● 72 FPS MR', w - 105, 48);
    });

    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 0.085, 0.015),
      new THREE.MeshStandardMaterial({ map: bannerTex })
    );
    banner.position.set(0, 0.37, 0.015);
    this.container.add(banner);

    // Tab Bar (Row of 5 tabs)
    const tabs = [
      { id: 'primitives', label: 'Primitivas' },
      { id: 'modify', label: 'Modificar' },
      { id: 'csg', label: 'CSG Booleans' },
      { id: 'materials', label: 'Materiales' },
      { id: 'export', label: 'Exportar' }
    ];
    const tabW = 0.12;
    const startX = -0.24;

    tabs.forEach((tab, i) => {
      const isActive = this.currentTab === tab.id;
      this._addButton(
        startX + i * tabW,
        0.285,
        tabW - 0.008,
        0.055,
        tab.label,
        '',
        () => {
          this.currentTab = tab.id;
          this._rebuildPanel();
        },
        {
          bgColor: isActive ? '#0284c7' : '#1e293b',
          borderColor: isActive ? '#38bdf8' : 'rgba(255,255,255,0.1)',
          active: isActive
        }
      );
    });

    // Content based on selected tab
    switch (this.currentTab) {
      case 'primitives':
        this._buildPrimitivesTab();
        break;
      case 'modify':
        this._buildModifyTab();
        break;
      case 'csg':
        this._buildCSGTab();
        break;
      case 'materials':
        this._buildMaterialsTab();
        break;
      case 'export':
        this._buildExportTab();
        break;
    }
  }

  _buildPrimitivesTab() {
    const items = [
      { id: 'box', label: '+ Cubo', sub: '20×20×20 cm' },
      { id: 'cylinder', label: '+ Cilindro', sub: 'Ø20 × H20 cm' },
      { id: 'sphere', label: '+ Esfera', sub: 'Ø20 cm' },
      { id: 'cone', label: '+ Cono', sub: 'Ø20 × H20 cm' },
      { id: 'wedge', label: '+ Cuña', sub: 'Rampa 45°' },
      { id: 'pyramid', label: '+ Pirámide', sub: 'Base 4 caras' },
      { id: 'torus', label: '+ Torus', sub: 'Anillo R10/r3' },
      { id: 'roof', label: '+ Techo', sub: 'Prisma triangular' }
    ];

    const colW = 0.28;
    const rowH = 0.08;
    const startY = 0.18;

    items.forEach((item, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? -0.15 : 0.15;
      const y = startY - row * (rowH + 0.015);

      this._addButton(
        x, y, colW, rowH,
        item.label, item.sub,
        () => this.callbacks.addPrimitive(item.id),
        { bgColor: '#0f172a', borderColor: '#38bdf8' }
      );
    });

    // Footer quick hint
    this._addFooterHint('Apunte con el láser y presione el gatillo para añadir a la mesa.');
  }

  _buildModifyTab() {
    const colW = 0.28;
    const rowH = 0.08;

    // Direct Scaling
    this._addButton(
      -0.15, 0.18, colW, rowH,
      'Escalar +10%', 'Agrandar fino',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(1.10),
      { bgColor: '#1e293b' }
    );
    this._addButton(
      0.15, 0.18, colW, rowH,
      'Escalar -10%', 'Reducir fino',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(0.90),
      { bgColor: '#1e293b' }
    );

    this._addButton(
      -0.15, 0.08, colW, rowH,
      'Escalar +25%', 'Agrandar paso',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(1.25),
      { bgColor: '#1e293b' }
    );
    this._addButton(
      0.15, 0.08, colW, rowH,
      'Escalar -25%', 'Reducir paso',
      () => this.callbacks.scaleSelected && this.callbacks.scaleSelected(0.75),
      { bgColor: '#1e293b' }
    );

    // Drop to workplane & Rotate
    this._addButton(
      -0.15, -0.02, colW, rowH,
      'Bajar a Mesa (Y=0)', 'Asentar base al plano',
      () => this.callbacks.dropToWorkplane && this.callbacks.dropToWorkplane(),
      { bgColor: '#0369a1', borderColor: '#38bdf8' }
    );
    this._addButton(
      0.15, -0.02, colW, rowH,
      'Rotar 90° (Y)', 'Giro en cuarto de vuelta',
      () => this.callbacks.rotateSelected && this.callbacks.rotateSelected(0, Math.PI / 2, 0),
      { bgColor: '#1e293b' }
    );

    // Magnet Grid Snap toggle & Reset
    this._addButton(
      -0.15, -0.12, colW, rowH,
      this.gridSnapEnabled ? 'Snap Grilla: ON' : 'Snap Grilla: OFF',
      'Paso magnético 25mm',
      () => {
        this.gridSnapEnabled = !this.gridSnapEnabled;
        if (this.callbacks.toggleGridSnap) this.callbacks.toggleGridSnap(this.gridSnapEnabled);
        this._rebuildPanel();
      },
      {
        bgColor: this.gridSnapEnabled ? '#065f46' : '#374151',
        borderColor: this.gridSnapEnabled ? '#10b981' : '#6b7280'
      }
    );
    this._addButton(
      0.15, -0.12, colW, rowH,
      'Restaurar Escala 1:1', 'Reset a 20 cm',
      () => this.callbacks.resetScale && this.callbacks.resetScale(),
      { bgColor: '#334155' }
    );

    this._addFooterHint('También puede usar el thumbstick del mando para redimensionar en mano.');
  }

  _buildCSGTab() {
    const colW = 0.28;
    const rowH = 0.085;

    // Solid vs Hole Toggle
    this._addButton(
      -0.15, 0.16, colW, rowH,
      'Sólido / Hueco', 'Alternar cortador',
      () => this.callbacks.toggleHole(),
      { bgColor: '#475569', borderColor: '#94a3b8' }
    );

    // CSG Grouping (Union or Subtraction)
    this._addButton(
      0.15, 0.16, colW, rowH,
      '⚡ Agrupar CSG', 'Unión o Corte booleano',
      () => this.callbacks.group(),
      { bgColor: '#15803d', borderColor: '#22c55e', active: true }
    );

    // CSG Intersection
    this._addButton(
      -0.15, 0.05, colW, rowH,
      '✂️ Intersección', 'Preservar solapamiento',
      () => this.callbacks.intersect && this.callbacks.intersect(),
      { bgColor: '#7c2d12', borderColor: '#ea580c' }
    );

    // Duplicate
    this._addButton(
      0.15, 0.05, colW, rowH,
      '📋 Duplicar', 'Clonar pieza seleccionada',
      () => this.callbacks.duplicate(),
      { bgColor: '#1e293b' }
    );

    // Delete
    this._addButton(
      0, -0.06, 0.58, rowH,
      '🗑️ Eliminar Seleccionado', 'Remover de la escena',
      () => this.callbacks.delete(),
      { bgColor: '#7f1d1d', borderColor: '#ef4444' }
    );

    this._addFooterHint('Para cortar: seleccione una pieza sólida y una hueca, luego pulse Agrupar.');
  }

  _buildMaterialsTab() {
    // Gravity Sketch 6.0 style Color and Material selector!
    const colors = [
      { hex: '#2563eb', name: 'Azul CAD' },
      { hex: '#f97316', name: 'Naranja' },
      { hex: '#10b981', name: 'Verde' },
      { hex: '#ef4444', name: 'Rojo' },
      { hex: '#eab308', name: 'Amarillo' },
      { hex: '#8b5cf6', name: 'Violeta' },
      { hex: '#f8fafc', name: 'Blanco' },
      { hex: '#1e293b', name: 'Grafito' }
    ];

    const colW = 0.28;
    const rowH = 0.065;
    const startY = 0.18;

    colors.forEach((c, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col === 0 ? -0.15 : 0.15;
      const y = startY - row * (rowH + 0.012);
      const isSelected = this.activeColor === c.hex;

      this._addButton(
        x, y, colW, rowH,
        c.name, '',
        () => {
          this.activeColor = c.hex;
          if (this.callbacks.setColor) this.callbacks.setColor(c.hex);
          this._rebuildPanel();
        },
        {
          bgColor: '#0f172a',
          colorDot: c.hex,
          active: isSelected,
          borderColor: isSelected ? '#38bdf8' : 'rgba(255,255,255,0.1)'
        }
      );
    });

    // Material finish row (Basic, Reflective, Clay)
    const finishes = [
      { id: 'basic', label: 'Básico CAD' },
      { id: 'reflective', label: 'Reflectivo' },
      { id: 'clay', label: 'Arcilla / Clay' }
    ];
    const finW = 0.18;
    finishes.forEach((f, i) => {
      const isCur = this.activeMaterial === f.id;
      this._addButton(
        -0.19 + i * (finW + 0.01),
        -0.15,
        finW,
        0.06,
        f.label,
        '',
        () => {
          this.activeMaterial = f.id;
          if (this.callbacks.setMaterialStyle) this.callbacks.setMaterialStyle(f.id);
          this._rebuildPanel();
        },
        {
          bgColor: isCur ? '#0284c7' : '#1e293b',
          active: isCur
        }
      );
    });

    this._addFooterHint('Seleccione un objeto para aplicar el color o acabado de material.');
  }

  _buildExportTab() {
    const fullW = 0.58;
    const rowH = 0.085;

    this._addButton(
      0, 0.15, fullW, rowH,
      '💾 Descargar STL (3D Print)', 'Formato estándar para slicers (Cura/Prusa)',
      () => this.callbacks.exportSTL(),
      { bgColor: '#0369a1', borderColor: '#38bdf8', active: true }
    );

    this._addButton(
      0, 0.04, fullW, rowH,
      '🌐 Descargar glTF / GLB', 'Modelo 3D con colores y materiales',
      () => this.callbacks.exportGLTF && this.callbacks.exportGLTF(),
      { bgColor: '#1e293b' }
    );

    this._addButton(
      0, -0.07, fullW, rowH,
      '🧹 Limpiar Mesa Completa', 'Borrar todas las piezas del espacio',
      () => this.callbacks.clear(),
      { bgColor: '#7f1d1d', borderColor: '#ef4444' }
    );

    this._addFooterHint('Los archivos se descargan directamente en el navegador del PICO.');
  }

  _addFooterHint(text) {
    const hintTex = this._createTexture((ctx, w, h) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 16);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
    });

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.045, 0.01),
      new THREE.MeshStandardMaterial({ map: hintTex })
    );
    mesh.position.set(0, -0.27, 0.015);
    this.container.add(mesh);
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

    btn.position.z = btn.userData.origZ - 0.008;
    setTimeout(() => {
      btn.position.z = btn.userData.origZ;
    }, 120);

    btn.userData.action();
  }
}
