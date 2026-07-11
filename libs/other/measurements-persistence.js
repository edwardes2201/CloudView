/**
 * Potree - Persistencia de mediciones (líneas / polilíneas) + capas + edición/borrado individual
 * ------------------------------------------------------------------------------------------
 * Usa el MISMO formato GeoJSON que ya exporta Potree con su botón nativo de guardar
 * mediciones (FeatureCollection de LineString/Polygon), solo que le agrega un campo
 * "layer" dentro de "properties" -algo que Potree no ofrece de fábrica-.
 *
 * Los Feature de tipo "Point" que genera Potree (son las etiquetas de distancia) se
 * ignoran al cargar: no son necesarios, Potree las vuelve a calcular solo.
 *
 * Versión para GitHub Pages (hosting estático, sin backend):
 *  - CARGA automática: al abrir la página, hace fetch del GeoJSON (funciona porque
 *    es un archivo estático más dentro del repo).
 *  - GUARDADO manual: no hay servidor que reciba un POST, así que el panel te da un
 *    botón "Descargar measure.json" con el archivo actualizado (incluyendo capas).
 *    Ese archivo hay que subirlo al repo reemplazando el anterior.
 *
 * El panel de control es FLOTANTE y fijo en la pantalla, independiente del sidebar
 * de Potree, para que siempre esté visible.
 *
 * Uso (una vez que el viewer ya existe):
 *
 *   initMeasurementsPersistence(viewer, {
 *     loadUrl: "./pointclouds/TEST_DATA/measure.json",
 *     downloadFilename: "measure.json"
 *   });
 */
(function () {

	// ---------- Conversión Measure <-> GeoJSON ----------

	function measurementToFeature(m) {
		const coords = m.points.map(p => {
			const pos = p.position || p;
			return [pos.x, pos.y, pos.z];
		});

		const isPolygon = !!m.closed && coords.length >= 3;

		return {
			type: "Feature",
			geometry: isPolygon
				? { type: "Polygon", coordinates: [ [...coords, coords[0]] ] }
				: { type: "LineString", coordinates: coords },
			properties: {
				name: m.name || "Distance",
				layer: m.layer || "Sin capa",
				visible: m.visible !== false,
				color: (m.color && m.color.getHexString) ? ("#" + m.color.getHexString()) : null,
				closed: !!m.closed,
				showDistances: m.showDistances !== false,
				uuid: m.uuid
			}
		};
	}

	function measurementsToGeoJSON(measurements) {
		return {
			type: "FeatureCollection",
			features: measurements.map(measurementToFeature)
		};
	}

	function featureToMeasurement(f) {
		if (!f || !f.geometry) return null;

		let coords, closed;
		if (f.geometry.type === "LineString") {
			coords = f.geometry.coordinates;
			closed = false;
		} else if (f.geometry.type === "Polygon") {
			coords = f.geometry.coordinates[0];
			closed = true;
		} else {
			// "Point" u otros: son etiquetas/marcas auxiliares de Potree, se ignoran
			return null;
		}

		if (!Array.isArray(coords) || coords.length < 2) return null;

		const props = f.properties || {};
		const m = new Potree.Measure();
		m.name = props.name || "Distance";
		m.layer = props.layer || "Sin capa";
		m.closed = closed;
		m.showDistances = props.showDistances !== false;

		// No usamos "new THREE.Vector3(...)" directamente porque en algunos builds de
		// Potree la variable global THREE no existe (viene empaquetada adentro de
		// potree.js). En cambio, clonamos un vector que Potree ya nos da hecho
		// (m.position, heredado de THREE.Object3D) y le cambiamos los valores.
		for (const c of coords) {
			const [x, y, z] = c;
			const v = m.position.clone();
			v.set(x, y, z);
			m.addMarker(v);
		}

		if (props.color && m.color && typeof m.color.set === "function") {
			try { m.color.set(props.color); } catch (e) { /* ignorar color inválido */ }
		}
		if (props.visible === false) m.visible = false;

		return m;
	}

	function geojsonToMeasurements(geojson) {
		if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
			throw new Error('Se esperaba un GeoJSON tipo FeatureCollection (el mismo formato que exporta Potree), con una propiedad "features" que sea un array.');
		}
		const out = [];
		for (const f of geojson.features) {
			const m = featureToMeasurement(f);
			if (m) out.push(m);
		}
		return out;
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

	// ---------- Lógica principal ----------

	window.initMeasurementsPersistence = function (viewer, options) {
		const cfg = Object.assign({
			loadUrl: null,
			downloadFilename: "measure.json"
		}, options);

		const state = { layers: new Set(["Sin capa"]), dirty: false };
		let $panel = null;
		let $body = null;

		function markDirty() {
			state.dirty = true;
			updateDownloadButtonLabel();
		}

		function updateDownloadButtonLabel() {
			if (!$panel) return;
			const $btn = $panel.find("#ml_download");
			$btn.text(state.dirty
				? "⚠ Descargar " + cfg.downloadFilename + " (cambios sin exportar)"
				: "Descargar " + cfg.downloadFilename);
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
				const geojson = await res.json();
				const measurements = geojsonToMeasurements(geojson);
				for (const m of measurements) {
					viewer.scene.addMeasurement(m);
					watchMeasurement(m);
				}
				renderPanel();
			} catch (err) {
				console.warn("Todavía no hay mediciones guardadas o no se pudieron cargar:", err);
			}
		}

		function importGeoJSON(geojson) {
			const measurements = geojsonToMeasurements(geojson); // puede tirar error, se maneja afuera
			for (const m of [...viewer.scene.measurements]) {
				viewer.scene.removeMeasurement(m);
			}
			for (const m of measurements) {
				viewer.scene.addMeasurement(m);
				watchMeasurement(m);
			}
			renderPanel();
		}

		// ---------- Panel flotante (independiente del sidebar de Potree) ----------

		function buildPanel() {
			const $p = $(
				'<div id="measurement_layers_panel" style="' +
				'position:fixed; top:60px; right:10px; width:280px; max-height:70vh; ' +
				'overflow-y:auto; background:#fff; border:1px solid #999; border-radius:6px; ' +
				'box-shadow:0 2px 8px rgba(0,0,0,0.3); z-index:10000; font-size:12px; font-family:sans-serif;">' +
				'<div id="ml_header" style="display:flex; justify-content:space-between; align-items:center; ' +
				'padding:6px 8px; background:#f0f0f0; border-bottom:1px solid #ccc; cursor:pointer;">' +
				'<b>Mediciones y capas</b><span id="ml_toggle">▾</span>' +
				'</div>' +
				'<div id="ml_body" style="padding:8px;">' +
				'<div id="ml_layer_list"></div>' +
				'<button id="ml_download" style="margin-top:6px; width:100%;">Descargar ' + cfg.downloadFilename + '</button>' +
				'<input type="file" id="ml_upload" accept="application/json" style="display:none;">' +
				'<button id="ml_upload_btn" style="margin-top:6px; width:100%;">Cargar archivo local...</button>' +
				'</div>' +
				'</div>'
			);
			$("body").append($p);
			$body = $p.find("#ml_body");

			$p.find("#ml_header").on("click", () => {
				$body.toggle();
				$p.find("#ml_toggle").text($body.is(":visible") ? "▾" : "▸");
			});

			$p.find("#ml_download").on("click", () => {
				const geojson = measurementsToGeoJSON(viewer.scene.measurements);
				downloadJSON(cfg.downloadFilename, JSON.stringify(geojson, null, 2));
				state.dirty = false;
				updateDownloadButtonLabel();
			});

			$p.find("#ml_upload_btn").on("click", () => $p.find("#ml_upload").click());
			$p.find("#ml_upload").on("change", async function () {
				const file = this.files[0];
				if (!file) return;

				let text, geojson;
				try {
					text = await file.text();
				} catch (err) {
					alert("No se pudo leer el archivo.");
					console.error(err);
					this.value = "";
					return;
				}

				try {
					geojson = JSON.parse(text);
				} catch (err) {
					alert("El archivo no es un JSON válido (error de sintaxis). Revisá que no lo hayas editado a mano de forma incorrecta.");
					console.error("Error de parseo JSON:", err);
					this.value = "";
					return;
				}

				try {
					importGeoJSON(geojson);
				} catch (err) {
					alert("El JSON es válido, pero no tiene el formato GeoJSON esperado.\n\nDetalle: " + err.message);
					console.error("Error al reconstruir las mediciones:", err);
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
						'<input type="text" class="ml_name" value="' + (m.name || "") + '" style="width:80px;">' +
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
		renderPanel();

		return { renderPanel };
	};

})();
