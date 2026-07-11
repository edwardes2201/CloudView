/**
 * Potree - Persistencia de mediciones (líneas / polilíneas) + capas + edición/borrado individual
 * ------------------------------------------------------------------------------------------
 * Versión para GitHub Pages (hosting estático, sin backend):
 *  - CARGA automática: al abrir la página, hace fetch de measurements.json (funciona
 *    porque es un archivo estático más dentro del repo).
 *  - GUARDADO manual: no existe servidor para recibir un POST, así que en vez de eso
 *    se ofrece un botón "Descargar measurements.json" que genera el archivo actualizado.
 *    Ese archivo hay que subirlo al repo (arrastrándolo en la web de GitHub o con
 *    git push) reemplazando el que está en la carpeta de la nube de puntos.
 *    Una vez subido, va a estar disponible para cualquiera que abra el link.
 *
 * Uso (una vez que el viewer ya existe):
 *
 *   initMeasurementsPersistence(viewer, {
 *     loadUrl: "./pointclouds/TEST_DATA/measurements.json",
 *     downloadFilename: "measurements.json"
 *   });
 */
(function () {

	function measurementToJSON(m) {
		return {
			uuid: m.uuid,
			name: m.name || "Medición",
			layer: m.layer || "Sin capa",
			visible: m.visible !== false,
			color: (m.color && m.color.getHexString) ? ("#" + m.color.getHexString()) : null,
			closed: !!m.closed,
			showDistances: m.showDistances !== false,
			showCoordinates: !!m.showCoordinates,
			showArea: !!m.showArea,
			showAngles: !!m.showAngles,
			showHeight: !!m.showHeight,
			showCircle: !!m.showCircle,
			points: m.points.map(p => {
				const pos = p.position || p;
				return [pos.x, pos.y, pos.z];
			})
		};
	}

	function measurementFromJSON(json) {
		const m = new Potree.Measure();
		m.name = json.name;
		m.layer = json.layer || "Sin capa";
		m.closed = !!json.closed;
		m.showDistances = json.showDistances !== false;
		m.showCoordinates = !!json.showCoordinates;
		m.showArea = !!json.showArea;
		m.showAngles = !!json.showAngles;
		m.showHeight = !!json.showHeight;
		m.showCircle = !!json.showCircle;

		for (const [x, y, z] of json.points) {
			m.addMarker(new THREE.Vector3(x, y, z));
		}

		if (json.color) {
			try { m.color = new THREE.Color(json.color); } catch (e) { /* ignorar */ }
		}
		if (json.visible === false) {
			m.visible = false;
		}
		return m;
	}

	function downloadJSON(filename, dataStr) {
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	window.initMeasurementsPersistence = function (viewer, options) {
		const cfg = Object.assign({
			loadUrl: null,
			downloadFilename: "measurements.json"
		}, options);

		const state = { layers: new Set(["Sin capa"]), dirty: false };
		let $panel = null;

		function markDirty() {
			state.dirty = true;
			updateDownloadButtonLabel();
		}

		function updateDownloadButtonLabel() {
			if (!$panel) return;
			const $btn = $panel.find("#ml_download");
			$btn.text(state.dirty
				? "⚠ Descargar measurements.json (hay cambios sin exportar)"
				: "Descargar measurements.json");
		}

		function watchMeasurement(m) {
			if (!m.layer) m.layer = "Sin capa";
			state.layers.add(m.layer);
			try {
				m.addEventListener("marker_added", markDirty);
				m.addEventListener("marker_removed", markDirty);
				m.addEventListener("marker_moved", markDirty);
				m.addEventListener("position_changed", markDirty);
			} catch (e) { /* ignorar si la versión no soporta alguno de estos eventos */ }
		}

		viewer.scene.addEventListener("measurement_added", e => {
			watchMeasurement(e.measurement);
			renderPanel();
			markDirty();
		});
		viewer.scene.addEventListener("measurement_removed", () => {
			renderPanel();
			markDirty();
		});

		async function loadAll() {
			if (!cfg.loadUrl) return;
			try {
				const res = await fetch(cfg.loadUrl, { cache: "no-store" });
				if (!res.ok) return;
				const data = await res.json();
				for (const json of data) {
					const m = measurementFromJSON(json);
					viewer.scene.addMeasurement(m);
					watchMeasurement(m);
				}
				renderPanel();
			} catch (err) {
				console.warn("Todavía no hay mediciones guardadas o no se pudieron cargar:", err);
			}
		}

		// ---------- Panel de capas / edición ----------

		function buildPanel() {
			const $p = $(
				'<div id="measurement_layers_panel" style="padding:8px; font-size:12px; border-top:1px solid #999;">' +
				'<h3 style="margin:4px 0;">Mediciones y capas</h3>' +
				'<div id="ml_layer_list"></div>' +
				'<button id="ml_download" style="margin-top:6px;">Descargar measurements.json</button>' +
				'<input type="file" id="ml_upload" accept="application/json" style="display:none;">' +
				'<button id="ml_upload_btn" style="margin-top:6px;">Cargar archivo local...</button>' +
				'</div>'
			);
			$("#potree_sidebar_container").append($p);

			$p.find("#ml_download").on("click", () => {
				const data = viewer.scene.measurements.map(measurementToJSON);
				downloadJSON(cfg.downloadFilename, JSON.stringify(data, null, 2));
				state.dirty = false;
				updateDownloadButtonLabel();
			});

			$p.find("#ml_upload_btn").on("click", () => $p.find("#ml_upload").click());
			$p.find("#ml_upload").on("change", async function () {
				const file = this.files[0];
				if (!file) return;
				try {
					const text = await file.text();
					const data = JSON.parse(text);
					// Reemplaza las mediciones actuales por las del archivo cargado
					for (const m of [...viewer.scene.measurements]) {
						viewer.scene.removeMeasurement(m);
					}
					for (const json of data) {
						const m = measurementFromJSON(json);
						viewer.scene.addMeasurement(m);
						watchMeasurement(m);
					}
					renderPanel();
				} catch (err) {
					alert("El archivo no es un JSON de mediciones válido.");
					console.error(err);
				}
				this.value = "";
			});

			return $p;
		}

		function renderPanel() {
			if (!$panel) $panel = buildPanel();
			const $list = $panel.find("#ml_layer_list");
			$list.empty();
			updateDownloadButtonLabel();

			const byLayer = {};
			for (const m of viewer.scene.measurements) {
				const layer = m.layer || "Sin capa";
				(byLayer[layer] = byLayer[layer] || []).push(m);
			}

			for (const layerName of Object.keys(byLayer)) {
				const $layerBox = $(
					'<div class="ml_layer" style="margin-bottom:10px; border:1px solid #ccc; border-radius:4px; padding:4px;">' +
					'<label><input type="checkbox" class="ml_layer_toggle" checked> <b>' + layerName + '</b></label>' +
					'<div class="ml_items"></div>' +
					'</div>'
				);

				const $items = $layerBox.find(".ml_items");

				for (const m of byLayer[layerName]) {
					const $row = $(
						'<div class="ml_item" style="display:flex; align-items:center; gap:4px; margin:4px 0;">' +
						'<input type="checkbox" class="ml_vis" ' + (m.visible !== false ? "checked" : "") + '>' +
						'<input type="text" class="ml_name" value="' + (m.name || "") + '" style="width:90px;">' +
						'<select class="ml_layer_select"></select>' +
						'<button class="ml_delete" title="Eliminar">Eliminar</button>' +
						'</div>'
					);

					const $sel = $row.find(".ml_layer_select");
					for (const l of state.layers) {
						$sel.append('<option value="' + l + '"' + (l === layerName ? " selected" : "") + '>' + l + '</option>');
					}
					$sel.append('<option value="__new__">+ Nueva capa...</option>');

					$row.find(".ml_vis").on("change", function () {
						m.visible = this.checked;
						markDirty();
					});

					$row.find(".ml_name").on("change", function () {
						m.name = this.value;
						markDirty();
					});

					$sel.on("change", function () {
						let val = this.value;
						if (val === "__new__") {
							val = prompt("Nombre de la nueva capa:", "");
							if (!val) { this.value = m.layer; return; }
							state.layers.add(val);
						}
						m.layer = val;
						renderPanel();
						markDirty();
					});

					$row.find(".ml_delete").on("click", function () {
						if (confirm('¿Eliminar la medición "' + m.name + '"?')) {
							viewer.scene.removeMeasurement(m);
							renderPanel();
							markDirty();
						}
					});

					$items.append($row);
				}

				$layerBox.find(".ml_layer_toggle").on("change", function () {
					const visible = this.checked;
					for (const m of byLayer[layerName]) m.visible = visible;
					renderPanel();
					markDirty();
				});

				$list.append($layerBox);
			}
		}

		loadAll();

		return { renderPanel };
	};

})();
