# PICO CAD MR — WebXR Spatial Tinkercad

Herramienta de diseño CAD paramétrico y CSG (*Constructive Solid Geometry*) inmersiva en la web, desarrollada específicamente para visores **PICO (PICO 4, PICO 4 Ultra, Neo 3)** con soporte nativo de **Passthrough a color**, y compatible con el emulador **Immersive Web Emulator** en escritorio.

🌐 **Demo en vivo (GitHub Pages con HTTPS oficial):**
👉 **https://lucahttp.github.io/pico-cad-xr/**

---

## 🥽 Uso en PICO Visor (Passthrough MR)

1. Abre el **Pico Browser** integrado en tu visor PICO.
2. Ingresa directamente a: **`https://lucahttp.github.io/pico-cad-xr/`**
   *(Al estar hosteado en GitHub Pages con certificado SSL válido de confianza pública, no hay advertencias de certificados autofirmados).*
3. Haz clic en el botón superior **"Entrar a MR (Passthrough)"**.
4. Se iniciará la sesión `immersive-ar`: el fondo se vuelve transparente y verás tu habitación física o mesa real mediante las cámaras de passthrough a color del PICO.
5. A tu izquierda flotará el **Pedestal Spatial 3D**:
   - **Gatillo (Trigger):** Apunta con el rayo láser y presiona para crear primitivas (`Cubo`, `Cilindro`, `Esfera`, etc.) o agarrar y mover objetos en 3D (6DoF).
   - **Grip (Agarre lateral):** Alterna el objeto seleccionado entre **Sólido** (azul/naranja) y **Hueco/Corte** (translúcido con wireframe tipo Tinkercad).
   - **Botón "Agrupar (CSG)":** Fusiona sólidos y recorta los huecos en tiempo real.
   - **Botón "Exportar STL":** Descarga directa de la pieza para impresión 3D.
   - **Botón "Exportar glTF":** Descarga directa de la escena para Blender o visualizadores espaciales.

---

## 💻 Pruebas en Desktop con Immersive Web Emulator

Si no tienes el visor puesto:
1. Instala la extensión de Chrome/Edge: [Immersive Web Emulator (Meta Quest / WebXR)](https://github.com/meta-quest/immersive-web-emulator/).
2. Abre DevTools (`F12`) y ve a la pestaña **WebXR**.
3. Activa la emulación de headset y controladores.
4. También puedes usar el modo 2D estándar con mouse (`OrbitControls`), atajos de teclado (`G` para agrupar, `H` para hueco, `Supr` para borrar) y la barra lateral translúcida.

---

## 🚀 Desarrollo Local

Si deseas correr o modificar el servidor en tu red local:

```bash
# Instalar dependencias
npm install

# Iniciar servidor local dev con HTTPS automático
npm run dev

# O compilar bundle de producción optimizado (~217 kB gzipped) y previsualizar:
npm run build
npm run preview
```

Para acceder desde el visor PICO en la misma red local (LAN):
- Obtén tu IP local con `ip route` (Linux) o `ipconfig getifaddr en0` (macOS).
- Abre en el Pico Browser: `https://<TU-IP-LOCAL>:3000/`.

---

## 🛠️ Arquitectura Técnica

- **Motor de Render:** Three.js (r186) con soporte WebXR (`immersive-ar`, `local-floor`, controllers y raycasting espacial).
- **Motor CSG:** `three-bvh-csg` acelerado por Bounding Volume Hierarchy, ejecutando uniones y sustracciones booleanas en submilisegundos en el chip Snapdragon XR2.
- **UI Espacial:** Componente 3D flotante con retroalimentación háptica visual.
- **Exportadores:** `STLExporter` y `GLTFExporter` integrados sin dependencias externas pesadas.
