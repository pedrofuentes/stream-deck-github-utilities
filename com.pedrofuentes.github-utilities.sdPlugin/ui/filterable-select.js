/**
 * FilterableSelect — Searchable dropdown component for Stream Deck Property Inspector.
 *
 * Replaces sdpi-select[datasource] dropdowns with a custom combobox that supports
 * type-to-filter for large lists (e.g. repositories, branches, workflows).
 *
 * Features:
 *   - Search/filter input (auto-shown when items exceed threshold)
 *   - Keyboard navigation (Arrow keys, Enter, Escape)
 *   - Matches Stream Deck PI dark theme via CSS custom properties
 *   - Syncs settings via WebSocket (setSettings)
 *   - Requests data via sendToPlugin (same as sdpi-components datasource)
 *   - Refresh button with spin animation
 *   - Dispatches 'change' CustomEvent on container for external listeners
 *
 * Usage:
 *   const fs = new FilterableSelect({
 *     container: document.getElementById('mySelect'),
 *     setting: 'repo',
 *     datasource: 'getRepos',
 *     placeholder: 'Choose a repository',
 *     searchPlaceholder: 'Search repositories…',
 *     threshold: 8,
 *     onChange: (value, label) => { ... },
 *   });
 *
 * Requires:
 *   - window._sdWebSocket (captured by WebSocket proxy in PI HTML)
 *   - window._sdUuid (captured by connectElgatoStreamDeckSocket wrapper)
 *   - window._sdAction (captured by connectElgatoStreamDeckSocket wrapper)
 *   - window._actionSettings (captured by connectElgatoStreamDeckSocket wrapper)
 *   - 'sdpi-datasource' CustomEvents dispatched by WebSocket interceptor
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
(function () {
	"use strict";

	// ── Default threshold ───────────────────────────────────────────
	var DEFAULT_THRESHOLD = 8;

	// ── CSS (injected once into <head>) ─────────────────────────────
	var STYLES = [
		/* Container wraps trigger row; dropdown is portalled to body */
		".fs-container {",
		"  position: relative;",
		"  width: 100%;",
		"}",

		/* Trigger row: combobox button + optional refresh */
		".fs-trigger-row {",
		"  display: flex;",
		"  gap: 4px;",
		"  align-items: stretch;",
		"}",

		/* Combobox trigger button — matches sdpi-select appearance */
		".fs-trigger {",
		"  flex: 1;",
		"  display: flex;",
		"  align-items: center;",
		"  justify-content: space-between;",
		"  background: var(--input-bg-color, #3d3d3d);",
		"  border: 1px solid transparent;",
		"  border-radius: var(--border-radius, 3px);",
		"  color: var(--font-color, #d8d8d8);",
		"  padding: 5px 8px;",
		"  font-size: var(--font-size, 12px);",
		"  font-family: var(--font-family, inherit);",
		"  cursor: pointer;",
		"  min-height: 26px;",
		"  text-align: left;",
		"  line-height: 1.3;",
		"  transition: border-color 0.15s;",
		"  box-sizing: border-box;",
		"  -webkit-appearance: none;",
		"  appearance: none;",
		"}",
		".fs-trigger:hover {",
		"  border-color: #666;",
		"}",
		".fs-trigger:focus {",
		"  outline: none;",
		"  border-color: #58a6ff;",
		"}",
		".fs-trigger .fs-label {",
		"  flex: 1;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  white-space: nowrap;",
		"}",
		".fs-trigger .fs-arrow {",
		"  margin-left: 6px;",
		"  font-size: 9px;",
		"  color: #999;",
		"  flex-shrink: 0;",
		"  transition: transform 0.2s;",
		"}",
		".fs-trigger.open .fs-arrow {",
		"  transform: rotate(180deg);",
		"}",
		".fs-trigger .fs-placeholder {",
		"  color: #888;",
		"}",

		/* Refresh button */
		".fs-refresh {",
		"  background: var(--input-bg-color, #3d3d3d);",
		"  border: 1px solid transparent;",
		"  border-radius: var(--border-radius, 3px);",
		"  color: #999;",
		"  cursor: pointer;",
		"  padding: 0 7px;",
		"  font-size: 14px;",
		"  line-height: 1;",
		"  transition: background 0.15s, color 0.15s;",
		"  flex-shrink: 0;",
		"  display: flex;",
		"  align-items: center;",
		"}",
		".fs-refresh:hover {",
		"  color: #e0e0e0;",
		"  border-color: #666;",
		"}",
		".fs-refresh.spinning {",
		"  animation: fs-spin 0.6s linear infinite;",
		"  pointer-events: none;",
		"}",
		"@keyframes fs-spin {",
		"  from { transform: rotate(0deg); }",
		"  to   { transform: rotate(360deg); }",
		"}",

		/* Dropdown panel — portalled to body, positioned with fixed */
		".fs-dropdown {",
		"  position: fixed;",
		"  z-index: 9999;",
		"  background: #252525;",
		"  border: 1px solid #555;",
		"  border-radius: 6px;",
		"  box-shadow: 0 8px 24px rgba(0,0,0,0.5);",
		"  display: none;",
		"  overflow: hidden;",
		"}",
		".fs-dropdown.open {",
		"  display: flex;",
		"  flex-direction: column;",
		"}",
		".fs-dropdown.flip-up {",
		"  flex-direction: column-reverse;",
		"}",
		".fs-dropdown.flip-up .fs-search {",
		"  border-bottom: none;",
		"  border-top: 1px solid #444;",
		"}",
		".fs-dropdown.flip-up .fs-count {",
		"  border-top: none;",
		"  border-bottom: 1px solid #333;",
		"}",

		/* Search input at top of dropdown */
		".fs-search {",
		"  display: block;",
		"  width: 100%;",
		"  box-sizing: border-box;",
		"  background: #1a1a1a;",
		"  border: none;",
		"  border-bottom: 1px solid #444;",
		"  color: #e0e0e0;",
		"  padding: 8px 10px;",
		"  font-size: 12px;",
		"  font-family: inherit;",
		"  outline: none;",
		"}",
		".fs-search::placeholder {",
		"  color: #666;",
		"}",
		".fs-search.hidden {",
		"  display: none;",
		"}",

		/* Scrollable option list */
		".fs-list {",
		"  max-height: 180px;",
		"  overflow-y: auto;",
		"  overflow-x: hidden;",
		"  scrollbar-width: thin;",
		"  scrollbar-color: #555 #252525;",
		"}",
		".fs-list::-webkit-scrollbar {",
		"  width: 6px;",
		"}",
		".fs-list::-webkit-scrollbar-track {",
		"  background: #252525;",
		"}",
		".fs-list::-webkit-scrollbar-thumb {",
		"  background: #555;",
		"  border-radius: 3px;",
		"}",

		/* Individual option */
		".fs-option {",
		"  padding: 6px 10px;",
		"  cursor: pointer;",
		"  font-size: 12px;",
		"  color: #d0d0d0;",
		"  white-space: nowrap;",
		"  overflow: hidden;",
		"  text-overflow: ellipsis;",
		"  transition: background 0.1s;",
		"}",
		".fs-option:hover,",
		".fs-option.highlighted {",
		"  background: #383838;",
		"  color: #f0f0f0;",
		"}",
		".fs-option.selected {",
		"  background: #264f78;",
		"  color: #58a6ff;",
		"}",
		".fs-option.selected:hover,",
		".fs-option.selected.highlighted {",
		"  background: #2d5a8a;",
		"}",
		".fs-option.disabled {",
		"  color: #666;",
		"  cursor: default;",
		"  font-style: italic;",
		"}",
		".fs-option.disabled:hover {",
		"  background: transparent;",
		"  color: #666;",
		"}",

		/* Empty state */
		".fs-empty {",
		"  padding: 12px 10px;",
		"  text-align: center;",
		"  color: #666;",
		"  font-size: 11px;",
		"}",

		/* Result count footer */
		".fs-count {",
		"  padding: 4px 10px;",
		"  font-size: 10px;",
		"  color: #666;",
		"  border-top: 1px solid #333;",
		"  text-align: right;",
		"}",
	].join("\n");

	var stylesInjected = false;
	function injectStyles() {
		if (stylesInjected) return;
		var style = document.createElement("style");
		style.textContent = STYLES;
		document.head.appendChild(style);
		stylesInjected = true;
	}

	// ── FilterableSelect Class ──────────────────────────────────────

	/**
	 * Creates a filterable/searchable dropdown to replace sdpi-select[datasource].
	 *
	 * @param {Object} options
	 * @param {HTMLElement} options.container   - DOM element to mount into
	 * @param {string}      options.setting     - Stream Deck setting key
	 * @param {string}      options.datasource  - Datasource event name (e.g. 'getRepos')
	 * @param {string}      [options.placeholder='Select…']       - Trigger placeholder
	 * @param {string}      [options.searchPlaceholder='Type to filter…'] - Search placeholder
	 * @param {number}      [options.threshold=8] - Show search when selectable items > N
	 * @param {function}    [options.onSelect]  - Called on every selection: (value, label) => void
	 * @param {function}    [options.onChange]   - Called only when value changes: (value, label) => void
	 */
	function FilterableSelect(options) {
		injectStyles();

		this.setting = options.setting;
		this.datasource = options.datasource;
		this.placeholder = options.placeholder || "Select…";
		this.searchPlaceholder = options.searchPlaceholder || "Type to filter…";
		this.threshold = options.threshold != null ? options.threshold : DEFAULT_THRESHOLD;
		this.onSelectCb = options.onSelect || null;
		this.onChangeCb = options.onChange || null;

		this.items = [];
		this.filteredItems = [];
		this.selectedValue = "";
		this.selectedLabel = "";
		this.isOpen = false;
		this.highlightedIndex = -1;

		this._container = options.container;
		this._wrapper = null;
		this._trigger = null;
		this._triggerLabel = null;
		this._dropdown = null;
		this._searchInput = null;
		this._list = null;
		this._emptyMsg = null;
		this._countLabel = null;
		this._refreshBtn = null;

		this._build();
		this._bindEvents();
		this._loadInitialValue();
		this._requestDatasource();
	}

	// ── DOM Construction ────────────────────────────────────────────

	FilterableSelect.prototype._build = function () {
		this._wrapper = document.createElement("div");
		this._wrapper.className = "fs-container";

		// Trigger row
		var triggerRow = document.createElement("div");
		triggerRow.className = "fs-trigger-row";

		this._trigger = document.createElement("button");
		this._trigger.className = "fs-trigger";
		this._trigger.type = "button";
		this._trigger.setAttribute("role", "combobox");
		this._trigger.setAttribute("aria-haspopup", "listbox");
		this._trigger.setAttribute("aria-expanded", "false");

		this._triggerLabel = document.createElement("span");
		this._triggerLabel.className = "fs-label fs-placeholder";
		this._triggerLabel.textContent = this.placeholder;

		var arrow = document.createElement("span");
		arrow.className = "fs-arrow";
		arrow.textContent = "▾";

		this._trigger.appendChild(this._triggerLabel);
		this._trigger.appendChild(arrow);
		triggerRow.appendChild(this._trigger);

		// Refresh button
		if (this.datasource) {
			this._refreshBtn = document.createElement("button");
			this._refreshBtn.className = "fs-refresh";
			this._refreshBtn.type = "button";
			this._refreshBtn.title = "Refresh";
			this._refreshBtn.textContent = "↻";
			triggerRow.appendChild(this._refreshBtn);
		}

		this._wrapper.appendChild(triggerRow);
		this._container.appendChild(this._wrapper);

		// Dropdown (portalled to body for overflow safety)
		this._dropdown = document.createElement("div");
		this._dropdown.className = "fs-dropdown";
		this._dropdown.setAttribute("role", "listbox");

		this._searchInput = document.createElement("input");
		this._searchInput.className = "fs-search hidden";
		this._searchInput.type = "text";
		this._searchInput.placeholder = this.searchPlaceholder;
		this._searchInput.setAttribute("autocomplete", "off");
		this._searchInput.setAttribute("spellcheck", "false");
		this._dropdown.appendChild(this._searchInput);

		this._list = document.createElement("div");
		this._list.className = "fs-list";
		this._dropdown.appendChild(this._list);

		this._emptyMsg = document.createElement("div");
		this._emptyMsg.className = "fs-empty";
		this._emptyMsg.textContent = "No matches found";
		this._emptyMsg.style.display = "none";
		this._dropdown.appendChild(this._emptyMsg);

		this._countLabel = document.createElement("div");
		this._countLabel.className = "fs-count";
		this._countLabel.style.display = "none";
		this._dropdown.appendChild(this._countLabel);

		document.body.appendChild(this._dropdown);
	};

	// ── Event Binding ───────────────────────────────────────────────

	FilterableSelect.prototype._bindEvents = function () {
		var self = this;

		// Toggle dropdown on trigger click
		this._trigger.addEventListener("click", function (e) {
			e.stopPropagation();
			self.toggle();
		});

		// Filter input
		this._searchInput.addEventListener("input", function () {
			self._applyFilter();
		});
		this._searchInput.addEventListener("keydown", function (e) {
			self._handleKeydown(e);
		});

		// Also allow keyboard on trigger when dropdown is closed
		this._trigger.addEventListener("keydown", function (e) {
			if (!self.isOpen && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
				e.preventDefault();
				self.open();
			}
		});

		// Refresh
		if (this._refreshBtn) {
			this._refreshBtn.addEventListener("click", function (e) {
				e.stopPropagation();
				self.refresh();
			});
		}

		// Close on outside click
		document.addEventListener("click", function (e) {
			if (self.isOpen && !self._wrapper.contains(e.target) && !self._dropdown.contains(e.target)) {
				self.close();
			}
		});

		// Listen for datasource events from WebSocket interceptor
		window.addEventListener("sdpi-datasource", function (e) {
			if (e.detail && e.detail.event === self.datasource) {
				self.setItems(e.detail.items || []);
			}
		});
	};

	// ── Data & Settings ─────────────────────────────────────────────

	FilterableSelect.prototype._loadInitialValue = function () {
		var settings = window._actionSettings || {};
		var val = settings[this.setting];
		if (val != null && val !== "") {
			this.selectedValue = String(val);
			// Show value as temporary label until data arrives with proper labels
			this.selectedLabel = this.selectedValue;
			this._updateTriggerDisplay();
		}
	};

	FilterableSelect.prototype._requestDatasource = function () {
		if (!this.datasource) return;

		var self = this;
		var attempt = function () {
			var ws = window._sdWebSocket;
			var uuid = window._sdUuid;
			var action = window._sdAction;
			if (ws && ws.readyState === WebSocket.OPEN && uuid) {
				ws.send(
					JSON.stringify({
						event: "sendToPlugin",
						action: action || "",
						context: uuid,
						payload: { event: self.datasource },
					}),
				);
			} else {
				setTimeout(attempt, 250);
			}
		};
		setTimeout(attempt, 300);
	};

	FilterableSelect.prototype.refresh = function () {
		if (this._refreshBtn) {
			this._refreshBtn.classList.add("spinning");
			var btn = this._refreshBtn;
			setTimeout(function () {
				btn.classList.remove("spinning");
			}, 800);
		}
		this._requestDatasource();
	};

	FilterableSelect.prototype.setItems = function (items) {
		this.items = (items || []).filter(function (i) {
			return i && i.value !== undefined;
		});

		// Update selected label if we now have the data
		if (this.selectedValue) {
			var match = this._findItem(this.selectedValue);
			if (match) {
				this.selectedLabel = match.label || match.value;
				this._updateTriggerDisplay();
			}
		}

		// Show/hide search based on selectable item count vs threshold
		var selectableCount = this.items.filter(function (i) {
			return !i.disabled && !(i.value === "" && i.label && i.label.indexOf("⚠") === 0);
		}).length;

		if (selectableCount > this.threshold) {
			this._searchInput.classList.remove("hidden");
		} else {
			this._searchInput.classList.add("hidden");
		}

		if (this._refreshBtn) {
			this._refreshBtn.classList.remove("spinning");
		}

		this._applyFilter();
	};

	FilterableSelect.prototype._findItem = function (value) {
		for (var i = 0; i < this.items.length; i++) {
			if (String(this.items[i].value) === String(value)) return this.items[i];
		}
		return null;
	};

	FilterableSelect.prototype._saveSetting = function (value) {
		var ws = window._sdWebSocket;
		var uuid = window._sdUuid;
		if (!ws || ws.readyState !== WebSocket.OPEN || !uuid) return;

		// Merge with current settings
		var settings = {};
		var current = window._actionSettings || {};
		for (var key in current) {
			if (current.hasOwnProperty(key)) settings[key] = current[key];
		}
		settings[this.setting] = value;
		window._actionSettings = settings;

		ws.send(
			JSON.stringify({
				event: "setSettings",
				context: uuid,
				payload: settings,
			}),
		);
	};

	// ── Filtering ───────────────────────────────────────────────────

	FilterableSelect.prototype._applyFilter = function () {
		var query = (this._searchInput.value || "").toLowerCase().trim();

		if (!query) {
			this.filteredItems = this.items.slice();
		} else {
			this.filteredItems = this.items.filter(function (item) {
				var label = (item.label || "").toLowerCase();
				var value = (item.value || "").toLowerCase();
				return label.indexOf(query) !== -1 || value.indexOf(query) !== -1;
			});
		}

		this.highlightedIndex = -1;
		this._renderList();
	};

	FilterableSelect.prototype._renderList = function () {
		this._list.innerHTML = "";
		var self = this;

		if (this.filteredItems.length === 0) {
			this._emptyMsg.style.display = "block";
			this._countLabel.style.display = "none";
			return;
		}

		this._emptyMsg.style.display = "none";

		for (var i = 0; i < this.filteredItems.length; i++) {
			(function (item, index) {
				var el = document.createElement("div");
				el.className = "fs-option";
				el.setAttribute("role", "option");
				el.dataset.value = item.value;
				el.dataset.index = String(index);
				el.textContent = item.label || item.value;

				var isDisabled =
					item.disabled === true || (item.value === "" && item.label && item.label.indexOf("⚠") === 0);
				if (isDisabled) {
					el.classList.add("disabled");
					el.setAttribute("aria-disabled", "true");
				}
				if (String(item.value) === String(self.selectedValue) && item.value !== "") {
					el.classList.add("selected");
					el.setAttribute("aria-selected", "true");
				}
				if (index === self.highlightedIndex) {
					el.classList.add("highlighted");
				}

				el.addEventListener("click", function (e) {
					e.stopPropagation();
					if (!isDisabled) {
						self._selectItem(item);
					}
				});

				self._list.appendChild(el);
			})(this.filteredItems[i], i);
		}

		// Show result count when filtering
		var total = this.items.filter(function (i) {
			return !i.disabled && !(i.value === "" && i.label && i.label.indexOf("⚠") === 0);
		}).length;
		var showing = this.filteredItems.filter(function (i) {
			return !i.disabled && !(i.value === "" && i.label && i.label.indexOf("⚠") === 0);
		}).length;

		if (this._searchInput.value && showing !== total) {
			this._countLabel.textContent = showing + " of " + total;
			this._countLabel.style.display = "block";
		} else {
			this._countLabel.style.display = "none";
		}
	};

	// ── Selection ───────────────────────────────────────────────────

	FilterableSelect.prototype._selectItem = function (item) {
		var oldValue = this.selectedValue;
		this.selectedValue = String(item.value);
		this.selectedLabel = item.label || item.value;

		this._updateTriggerDisplay();
		this._saveSetting(item.value);
		this.close();

		if (this.onSelectCb) this.onSelectCb(item.value, item.label);
		if (oldValue !== String(item.value) && this.onChangeCb) {
			this.onChangeCb(item.value, item.label);
		}

		// Dispatch change event on container for external listeners
		var event = new CustomEvent("change", {
			detail: { value: item.value, label: item.label },
			bubbles: true,
		});
		this._container.dispatchEvent(event);
	};

	FilterableSelect.prototype._updateTriggerDisplay = function () {
		if (this.selectedLabel) {
			this._triggerLabel.textContent = this.selectedLabel;
			this._triggerLabel.classList.remove("fs-placeholder");
		} else {
			this._triggerLabel.textContent = this.placeholder;
			this._triggerLabel.classList.add("fs-placeholder");
		}
	};

	// ── Open / Close ────────────────────────────────────────────────

	FilterableSelect.prototype.toggle = function () {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	};

	FilterableSelect.prototype.open = function () {
		if (this.isOpen) return;
		this.isOpen = true;

		var rect = this._trigger.getBoundingClientRect();
		var viewportH = window.innerHeight;
		var gap = 2;
		var spaceBelow = viewportH - rect.bottom - gap;
		var spaceAbove = rect.top - gap;

		// Reset any previous positioning
		this._dropdown.style.top = "";
		this._dropdown.style.bottom = "";
		this._dropdown.style.left = rect.left + "px";
		this._dropdown.style.width = rect.width + "px";
		this._dropdown.classList.remove("flip-up");

		// Measure how tall the dropdown wants to be (render hidden to get natural height)
		this._dropdown.style.visibility = "hidden";
		this._dropdown.style.maxHeight = "none";
		this._list.style.maxHeight = "none";
		this._dropdown.classList.add("open");
		this._searchInput.value = "";
		this._applyFilter();

		var naturalHeight = this._dropdown.offsetHeight;
		var minUsable = 120; // minimum usable dropdown height

		// Decide direction: prefer below, flip above if not enough space
		var openAbove = spaceBelow < Math.min(naturalHeight, minUsable) && spaceAbove > spaceBelow;
		var availableSpace = openAbove ? spaceAbove : spaceBelow;

		// Constrain list max-height so dropdown fits in available space
		// Account for search input (~35px), count footer (~24px), borders (~4px)
		var chrome = 65;
		var listMax = Math.max(availableSpace - chrome, 60);
		this._list.style.maxHeight = listMax + "px";

		if (openAbove) {
			this._dropdown.style.bottom = (viewportH - rect.top + gap) + "px";
			this._dropdown.classList.add("flip-up");
		} else {
			this._dropdown.style.top = (rect.bottom + gap) + "px";
		}

		// Constrain overall dropdown height
		this._dropdown.style.maxHeight = availableSpace + "px";
		this._dropdown.style.visibility = "";

		this._trigger.classList.add("open");
		this._trigger.setAttribute("aria-expanded", "true");

		// Focus search if visible
		if (!this._searchInput.classList.contains("hidden")) {
			this._searchInput.focus();
		}

		// Scroll selected item into view
		var self = this;
		requestAnimationFrame(function () {
			var selected = self._list.querySelector(".fs-option.selected");
			if (selected) {
				selected.scrollIntoView({ block: "nearest" });
			}
		});
	};

	FilterableSelect.prototype.close = function () {
		if (!this.isOpen) return;
		this.isOpen = false;
		this._dropdown.classList.remove("open");
		this._dropdown.classList.remove("flip-up");
		this._trigger.classList.remove("open");
		this._trigger.setAttribute("aria-expanded", "false");
		this.highlightedIndex = -1;
		// Reset dynamic sizing
		this._list.style.maxHeight = "";
		this._dropdown.style.maxHeight = "";
	};

	// ── Keyboard Navigation ─────────────────────────────────────────

	FilterableSelect.prototype._handleKeydown = function (e) {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				if (this.highlightedIndex < this.filteredItems.length - 1) {
					this.highlightedIndex++;
					this._updateHighlight();
				}
				break;

			case "ArrowUp":
				e.preventDefault();
				if (this.highlightedIndex > 0) {
					this.highlightedIndex--;
					this._updateHighlight();
				}
				break;

			case "Enter":
				e.preventDefault();
				if (this.highlightedIndex >= 0 && this.highlightedIndex < this.filteredItems.length) {
					var item = this.filteredItems[this.highlightedIndex];
					var isDisabled =
						item.disabled === true ||
						(item.value === "" && item.label && item.label.indexOf("⚠") === 0);
					if (!isDisabled) {
						this._selectItem(item);
					}
				}
				break;

			case "Escape":
				e.preventDefault();
				this.close();
				this._trigger.focus();
				break;
		}
	};

	FilterableSelect.prototype._updateHighlight = function () {
		var options = this._list.querySelectorAll(".fs-option");
		for (var i = 0; i < options.length; i++) {
			if (i === this.highlightedIndex) {
				options[i].classList.add("highlighted");
			} else {
				options[i].classList.remove("highlighted");
			}
		}
		// Scroll highlighted into view
		if (this.highlightedIndex >= 0 && options[this.highlightedIndex]) {
			options[this.highlightedIndex].scrollIntoView({ block: "nearest" });
		}
	};

	// ── Public API ──────────────────────────────────────────────────

	Object.defineProperty(FilterableSelect.prototype, "value", {
		get: function () {
			return this.selectedValue;
		},
		set: function (val) {
			this.selectedValue = String(val || "");
			var match = this._findItem(this.selectedValue);
			this.selectedLabel = match ? match.label || match.value : this.selectedValue;
			this._updateTriggerDisplay();
		},
	});

	/**
	 * Destroy the component and clean up DOM.
	 */
	FilterableSelect.prototype.destroy = function () {
		if (this._dropdown && this._dropdown.parentNode) {
			this._dropdown.parentNode.removeChild(this._dropdown);
		}
		if (this._wrapper && this._wrapper.parentNode) {
			this._wrapper.parentNode.removeChild(this._wrapper);
		}
	};

	// ── Export ───────────────────────────────────────────────────────
	window.FilterableSelect = FilterableSelect;
})();
