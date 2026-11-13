/* Automation log — left-side entry that lists the most recent automation runs
 * and opens the chat each one was delivered into.
 *
 * Defensive by design: slot placement, the schedule read and every render step
 * are guarded, so a missing slot or an unavailable Remote namespace can never
 * fail the client boot. Placement is retried until the sidebar slot exists.
 */
window.__ModuleLoader__.load({
	id: "dsh-automation-log",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		/** Panel identity shared by the sidebar row and the main keyed slot. */
		const PANEL_ID = "automation-log";
		/** Refresh cadence; deliveries happen on the minute, so a slow poll is enough. */
		const POLL_MS = 20000;
		/** How many runs the feed keeps. */
		const MAX_ROWS = 30;

		/** Read-only route that serves the watcher event feed (host half of this plugin). */
		const WATCH_ROUTE = "/automation-log/watch-events";
		/** Short names for the local watchers that write the event feed. */
		const WATCHER_LABEL = { tv: "ТВ", photo: "Фото ШУ", release: "Выпуск ШУ" };

		const LABEL = "Автоматизации";
		const SUBTITLE = "Последние запуски задач и действия наблюдателей. Нажмите, чтобы открыть чат.";
		const EMPTY = "Пока не было запусков автоматизаций и действий наблюдателей.";
		const EMPTY_HINT = "Запуски и события появятся здесь после первого срабатывания.";
		const RETRY = "Обновить";
		const LOADING = "Загружаю…";
		const FAILED = "Не удалось прочитать задачи автоматизации.";

		const STATUS_LABEL = {
			active: "активна",
			paused: "на паузе",
			ended: "завершена"
		};

		const COLOR = {
			primary: "var(--dsw-alias-label-primary, #e6e6e6)",
			secondary: "var(--dsw-alias-label-secondary, #9aa0a6)",
			tertiary: "var(--dsw-alias-label-tertiary, #7c8288)",
			border: "var(--dsw-alias-border-l1, rgba(255,255,255,0.10))",
			hover: "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))",
			accent: "var(--dsw-alias-brand-primary, #4d6bfe)"
		};

		/** Human text and color for watcher event severity. */
		const STATUS_TEXT = { ok: "успешно", info: "информация", warn: "предупреждение", error: "ошибка" };
		const STATUS_COLOR = { ok: COLOR.secondary, info: COLOR.secondary, warn: "#d9a441", error: "#e05a5a" };

		/** Two-digit padding. */
		function pad(n) {
			return n < 10 ? "0" + n : String(n);
		}

		/** One local timestamp: time for today, short date otherwise. */
		function formatWhen(iso) {
			const ms = Date.parse(iso);
			if (!Number.isFinite(ms)) return "";
			const when = new Date(ms);
			const now = new Date();
			const sameDay = when.getFullYear() === now.getFullYear()
				&& when.getMonth() === now.getMonth()
				&& when.getDate() === now.getDate();
			const time = pad(when.getHours()) + ":" + pad(when.getMinutes());
			if (sameDay) return time;
			return pad(when.getDate()) + "." + pad(when.getMonth() + 1) + " " + time;
		}

		/** Short text for a stored prompt. */
		function promptSnippet(prompt) {
			if (typeof prompt !== "string") return "";
			const single = prompt.replace(/\s+/g, " ").trim();
			return single.length > 140 ? single.slice(0, 137) + "…" : single;
		}

		/** Feed rows out of one catalog snapshot. */
		function runsOf(tasks) {
			const rows = [];
			if (!Array.isArray(tasks)) return rows;
			for (const task of tasks) {
				if (!task || typeof task !== "object") continue;
				const delivery = task.lastDelivery;
				if (!delivery || typeof delivery !== "object") continue;
				if (typeof delivery.targetSessionId !== "string" || !delivery.targetSessionId) continue;
				rows.push({
					kind: "task",
					taskId: String(task.id || ""),
					title: typeof task.title === "string" && task.title.trim() ? task.title.trim() : "Без названия",
					prompt: promptSnippet(task.prompt),
					status: typeof task.status === "string" ? task.status : "",
					at: String(delivery.deliveredAt || delivery.scheduledAt || ""),
					sessionId: delivery.targetSessionId
				});
			}
			rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
			return rows.slice(0, MAX_ROWS);
		}

		/** Watcher events out of the host route; an unreachable route is an empty feed. */
		function fetchWatchEvents() {
			return fetch(WATCH_ROUTE, { cache: "no-store", credentials: "same-origin" })
				.then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status))))
				.then((raw) => {
					const value = raw && raw.ok === true ? raw : raw;
					const list = value && Array.isArray(value.events) ? value.events : [];
					return list.map((event) => ({
						kind: "watch",
						taskId: "watch:" + String(event.ts || "") + ":" + String(event.title || ""),
						watcher: typeof event.watcher === "string" ? event.watcher : "",
						title: typeof event.title === "string" ? event.title : "",
						prompt: typeof event.detail === "string" ? event.detail : "",
						status: typeof event.status === "string" ? event.status : "",
						action: typeof event.action === "string" ? event.action : "",
						at: String(event.ts || ""),
						sessionId: ""
					}));
				})
				.catch((error) => {
					console.warn("[automation-log] watch events unavailable", error);
					return [];
				});
		}

		/** One catalog read; accepts both the envelope and the plain value. */
		function readCatalog(ctx) {
			return Promise.resolve()
				.then(() => ctx.remote.schedule.catalog())
				.then((raw) => {
					const value = raw && raw.ok === true ? raw.value : raw;
					if (value && value.ok === false) throw new Error("schedule/catalog failed");
					if (!Array.isArray(value)) throw new Error("schedule/catalog is not a list");
					return value;
				});
		}

		/** Navigate to the session that accepted the delivery. */
		function openSession(ctx, sessionId) {
			try {
				const uiWorkspace = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : void 0;
				if (uiWorkspace && typeof uiWorkspace.openSession === "function") {
					uiWorkspace.openSession(sessionId);
					return true;
				}
			} catch (error) {
				console.warn("[automation-log] openSession failed", error);
			}
			console.warn("[automation-log] uiWorkspace.openSession is unavailable");
			return false;
		}

		/** Module-level feed store; the panel subscribes to it. */
		const store = {
			state: { phase: "loading", rows: [], error: null },
			listeners: new Set(),
			set(next) {
				store.state = next;
				for (const listener of store.listeners) {
					try {
						listener();
					} catch (error) {
						console.warn("[automation-log] listener failed", error);
					}
				}
			},
			subscribe(fn) {
				store.listeners.add(fn);
				return () => store.listeners.delete(fn);
			}
		};

		let inFlight = null;

		/** Refresh the feed once, sharing a single in-flight read. */
		function refresh(ctx) {
			if (inFlight) return inFlight;
			inFlight = Promise.all([readCatalog(ctx), fetchWatchEvents()]).then(([tasks, watchRows]) => {
				const rows = runsOf(tasks).concat(watchRows)
					.sort((a, b) => String(b.at).localeCompare(String(a.at)))
					.slice(0, MAX_ROWS);
				store.set({ phase: "ready", rows, error: null });
			}).catch((error) => {
				console.warn("[automation-log] catalog read failed", error);
				store.set({ phase: "error", rows: store.state.rows, error: String(error && error.message || error) });
			}).finally(() => {
				inFlight = null;
			});
			return inFlight;
		}

		function useFeed(ctx) {
			const [tick, setTick] = react.useState(0);
			react.useEffect(() => store.subscribe(() => setTick((value) => value + 1)), []);
			react.useEffect(() => {
				refresh(ctx);
				const timer = setInterval(() => refresh(ctx), POLL_MS);
				const onVisible = () => {
					if (document.visibilityState === "visible") refresh(ctx);
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					clearInterval(timer);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, []);
			return { state: store.state, tick };
		}

		/** One clickable run row. */
		function RunRow({ row, onOpen }) {
			const [hover, setHover] = react.useState(false);
			const isWatch = row.kind === "watch";
			const interactive = !isWatch && typeof onOpen === "function";
			const watcherLabel = WATCHER_LABEL[row.watcher] || row.watcher || "Наблюдатель";
			const when = formatWhen(row.at);
			const status = isWatch ? STATUS_TEXT[row.status] || row.status : STATUS_LABEL[row.status] || row.status;
			return react.createElement("div", {
				role: interactive ? "button" : "group",
				tabIndex: interactive ? 0 : -1,
				"data-automation-run": row.taskId,
				"data-automation-kind": isWatch ? "watch" : "task",
				title: when ? when + " · " + (row.status || "") : "",
				onClick: interactive ? () => onOpen(row.sessionId) : undefined,
				onKeyDown: interactive ? (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onOpen(row.sessionId);
					}
				} : undefined,
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				onFocus: () => setHover(true),
				onBlur: () => setHover(false),
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					width: "100%",
					padding: "10px 12px",
					marginBottom: 6,
					textAlign: "left",
					cursor: interactive ? "pointer" : "default",
					border: "1px solid " + (hover ? COLOR.accent : COLOR.border),
					borderRadius: 10,
					background: hover ? COLOR.hover : "transparent",
					outline: "none",
					color: COLOR.primary,
					font: "inherit",
					transition: "background 120ms ease, border-color 120ms ease"
				}
			}, [
				react.createElement("div", {
					key: "line",
					style: {
						display: "flex",
						alignItems: "baseline",
						justifyContent: "space-between",
						gap: 12
					}
				}, [
					react.createElement("span", {
						key: "title",
						style: {
							fontSize: 14,
							lineHeight: "20px",
							fontWeight: 550,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						}
					}, isWatch ? watcherLabel + " · " + row.title : row.title),
					react.createElement("span", {
						key: "when",
						style: {
							fontSize: 12,
							lineHeight: "18px",
							color: COLOR.secondary,
							fontVariantNumeric: "tabular-nums",
							whiteSpace: "nowrap"
						}
					}, when)
				]),
				row.prompt ? react.createElement("div", {
					key: "prompt",
					style: {
						fontSize: 12,
						lineHeight: "17px",
						color: COLOR.secondary,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					}
				}, row.prompt) : null,
				status ? react.createElement("div", {
					key: "status",
					style: {
						fontSize: 11,
						lineHeight: "16px",
						color: isWatch ? (STATUS_COLOR[row.status] || COLOR.secondary) : COLOR.tertiary
					}
				}, status) : null
			]);
		}

		/** The global panel: header, refresh control and the run feed. */
		function AutomationLogPanel(props) {
			const ctx = props && props.ctx ? props.ctx : panelContext;
			const feed = useFeed(ctx);
			const state = feed.state;
			const rows = state.rows;
			const open = (sessionId) => {
				const navigated = openSession(ctx, sessionId);
				if (!navigated) console.warn("[automation-log] cannot open session", sessionId);
			};
			return react.createElement("div", {
				style: {
					height: "100%",
					overflowY: "auto",
					boxSizing: "border-box",
					padding: "calc(var(--dsh-frame-top-clearance, 0px) + 28px) 24px 32px"
				}
			}, react.createElement("div", {
				style: {
					maxWidth: 820,
					margin: "0 auto"
				}
			}, [
				react.createElement("div", {
					key: "header",
					style: {
						display: "flex",
						alignItems: "flex-start",
						justifyContent: "space-between",
						gap: 16,
						marginBottom: 18
					}
				}, [
					react.createElement("div", { key: "text" }, [
						react.createElement("h2", {
							key: "title",
							style: {
								margin: 0,
								fontSize: 20,
								lineHeight: "26px",
								fontWeight: 600,
								color: COLOR.primary
							}
						}, LABEL),
						react.createElement("div", {
							key: "sub",
							style: {
								marginTop: 4,
								fontSize: 13,
								lineHeight: "18px",
								color: COLOR.secondary
							}
						}, SUBTITLE)
					]),
					react.createElement("button", {
						key: "refresh",
						type: "button",
						onClick: () => refresh(ctx),
						style: {
							padding: "6px 12px",
							borderRadius: 8,
							border: "1px solid " + COLOR.border,
							background: "transparent",
							color: COLOR.secondary,
							font: "inherit",
							fontSize: 12,
							cursor: "pointer"
						}
					}, RETRY)
				]),
				state.phase === "loading" && rows.length === 0 ? react.createElement("div", {
					key: "loading",
					style: { color: COLOR.secondary, fontSize: 13 }
				}, LOADING) : null,
				state.phase === "error" ? react.createElement("div", {
					key: "error",
					style: {
						marginBottom: 12,
						padding: "10px 12px",
						borderRadius: 10,
						border: "1px solid " + COLOR.border,
						color: COLOR.secondary,
						fontSize: 12
					}
				}, FAILED + " " + (state.error || "")) : null,
				rows.length === 0 && state.phase !== "loading" ? react.createElement("div", {
					key: "empty",
					style: {
						padding: "24px 12px",
						color: COLOR.secondary,
						fontSize: 13,
						textAlign: "center"
					}
				}, [react.createElement("div", { key: "a" }, EMPTY), react.createElement("div", {
					key: "b",
					style: { marginTop: 4, color: COLOR.tertiary, fontSize: 12 }
				}, EMPTY_HINT)]) : null,
				react.createElement("div", { key: "rows" }, rows.map((row) => react.createElement(RunRow, {
					key: row.taskId + ":" + row.at,
					row,
					onOpen: open
				})))
			]));
		}

		/** Clock glyph for the sidebar row. */
		function AutomationLogIcon({ size }) {
			const px = typeof size === "number" && size > 0 ? size : 16;
			return react.createElement("svg", {
				width: px,
				height: px,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true"
			}, [
				react.createElement("circle", {
					key: "c",
					cx: 8,
					cy: 8,
					r: 6.2,
					stroke: "currentColor",
					strokeWidth: 1.4
				}),
				react.createElement("path", {
					key: "h",
					d: "M8 4.6V8l2.2 1.4",
					stroke: "currentColor",
					strokeWidth: 1.4,
					strokeLinecap: "round"
				})
			]);
		}

		/** Panel context captured by apply so the component can reach services. */
		let panelContext = null;

		/** Required services: slots and the schedule Remote namespace. */
		const inject = ["slots", "remote", "remote.schedule"];

		/** Place both registrations, retrying while the slots are not declared yet. */
		function place(ctx, attempt = 0) {
			try {
				ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 20,
					label: () => LABEL
				}, AutomationLogIcon));
				ctx.slots.inject("main", () => ctx.slots.register({
					name: "main",
					key: PANEL_ID
				}, AutomationLogPanel));
				return true;
			} catch (error) {
				if (attempt < 20) {
					setTimeout(() => place(ctx, attempt + 1), 1000);
				} else {
					console.warn("[automation-log] could not place the panel", error);
				}
				return false;
			}
		}

		/** Never throw out of apply: a failed panel must not fail the client boot. */
		function apply(ctx) {
			try {
				panelContext = ctx;
				refresh(ctx);
				place(ctx);
			} catch (error) {
				console.warn("[automation-log] apply failed", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
