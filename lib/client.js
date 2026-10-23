// Browser half of dsh-fold-turns. Native completed-turn accounting comes from the current
// session's Chat snapshot, never from the cumulative composer footer or React internals.
// Each header gets one plugin-owned, accessible disclosure; native React children are left
// alone. Opening a reply preserves the independent native process disclosure beneath it.
// Hand-written in the lazy-CJS shape dsh's client bundles use; no build step.
window.__ModuleLoader__.load({
	id: "dsh-fold-turns",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const FLOW_SELECTOR = "[data-chat-flow]";
		const ROW_SELECTOR = "[data-chat-flow-key][data-chat-turn]";
		const PROCESS_OPEN_SELECTOR = "button[data-turn-process][aria-expanded=\"true\"]";
		const SLIDE_MS = 280;
		/** Most air left above your message when the newest turn is scrolled to the top. */
		const PIN_GAP = 8;
		/** Extra scroll room kept below the pinned position. */
		const PIN_SLACK = 48;
		/** How long the newest turn takes to glide to the top. */
		const PIN_MS = 380;
		/** Events that mean the reader is scrolling by hand. */
		const INTENTS = ["wheel", "touchstart", "keydown"];
		const FADE_MS = 160;

		const CSS = `
[data-dsh-fold="closed"]{display:none !important}
[data-dsh-fold="closing"]{overflow:hidden !important;pointer-events:none}
[data-dsh-fold-control]{box-sizing:border-box;width:100%;margin:20px 0 28px;padding:0 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l2,#303034);text-align:left}
[data-dsh-fold-head="open"]>[data-dsh-fold-control][data-native-process="true"]{border-bottom:0;padding-bottom:0;margin-bottom:8px}
[data-dsh-fold-button]{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;max-width:100%;min-height:24px;padding:0;border:0;border-radius:3px;background:transparent;cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#b7bbc1);text-align:left;user-select:none}
[data-dsh-fold-total]{flex:none}
[data-dsh-fold-cache]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-dsh-fold-cache],[data-dsh-fold-dot]{color:var(--dsw-alias-label-tertiary,#868c95)}
[data-dsh-fold-button]:hover,[data-dsh-fold-button]:focus-visible{color:var(--dsw-alias-label-primary,#e3e5e9)}
[data-dsh-fold-button]:hover [data-dsh-fold-cache],[data-dsh-fold-button]:focus-visible [data-dsh-fold-cache]{color:var(--dsw-alias-label-secondary,#b7bbc1)}
[data-dsh-fold-button]:focus-visible{outline:2px solid var(--dsw-alias-accent-primary,#80aaff);outline-offset:4px}
[data-dsh-fold-chevron]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:20px;margin-left:2px}
[data-dsh-fold-chevron]::before{content:"";display:block;width:6px;height:6px;border-top:1.25px solid currentColor;border-right:1.25px solid currentColor;transform:rotate(45deg);transition:transform 160ms ease}
[data-dsh-fold-button][aria-expanded="true"] [data-dsh-fold-chevron]::before{transform:rotate(135deg)}
[data-dsh-fold-tooltip]{position:fixed;z-index:1200;box-sizing:border-box;width:280px;max-width:calc(100vw - 24px);padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#383a40);border-radius:10px;background:var(--dsw-specific-menu,#222326);box-shadow:0 8px 24px #0003;color:var(--dsw-alias-label-secondary,#b7bbc1);font:13px/20px system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;pointer-events:none}
[data-dsh-fold-tooltip][hidden]{display:none}
[data-dsh-fold-tooltip-title]{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px;color:var(--dsw-alias-label-primary,#e3e5e9)}
[data-dsh-fold-tooltip] dl{display:grid;grid-template-columns:1fr auto;gap:4px 16px;margin:0}
[data-dsh-fold-tooltip] dt,[data-dsh-fold-tooltip] dd{margin:0}
[data-dsh-fold-tooltip] dt{color:var(--dsw-alias-label-tertiary,#868c95)}
[data-dsh-fold-tooltip] dd{text-align:right}
[data-dsh-fold-tooltip-action]{margin-top:10px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2,#383a40);color:var(--dsw-alias-label-tertiary,#868c95)}
@media(prefers-reduced-motion:reduce){[data-dsh-fold-chevron]::before{transition:none}}
`;

		const text = { show: "展开回复", hide: "收起回复", cache: "缓存命中", title: "本轮用量", unavailable: "用量 —", missing: "—" };
		const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
		const exact = (value) => isCount(value) ? new Intl.NumberFormat("zh-CN").format(value) : text.missing;
		function compact(value) {
			if (!isCount(value)) return text.unavailable;
			for (const [scale, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
				if (value >= scale) return `${Number((value / scale).toFixed(1))}${suffix} tok`;
			}
			return `${value} tok`;
		}
		function cachePercent(usage) {
			if (!usage || !isCount(usage.totalTokens) || !isCount(usage.outputTokens) || !isCount(usage.cacheReadTokens)) return text.missing;
			const prompt = usage.totalTokens - usage.outputTokens;
			if (prompt <= 0 || usage.cacheReadTokens > prompt) return text.missing;
			const rate = usage.cacheReadTokens / prompt * 100;
			const rounded = Number(rate.toFixed(1));
			if (rounded === 100 && usage.cacheReadTokens < prompt) return ">99.9%";
			if (rounded === 0 && usage.cacheReadTokens > 0) return "<0.1%";
			return `${rounded}%`;
		}
		function element(tag, attr, value) {
			const el = document.createElement(tag);
			if (attr) el.setAttribute(attr, "");
			if (value !== undefined) el.textContent = value;
			return el;
		}
		function content(el, value) {
			if (el.textContent !== value) el.textContent = value;
		}

		/** Rows that are not nested in another row (groups wrap their member rows). */
		function topRows(flow) {
			const rows = [];
			for (const el of flow.querySelectorAll(ROW_SELECTOR)) {
				const outer = el.parentElement === null ? null : el.parentElement.closest("[data-chat-flow-key]");
				if (outer === null || !flow.contains(outer)) rows.push(el);
			}
			return rows;
		}

		/** Row gap of the real layout box above `row` (skips `display: contents` wrappers). */
		function rowGap(row) {
			for (let node = row.parentElement; node !== null; node = node.parentElement) {
				const style = getComputedStyle(node);
				if (style.display === "contents") continue;
				const gap = parseFloat(style.rowGap);
				return Number.isFinite(gap) ? gap : 0;
			}
			return 0;
		}

		function setAttr(el, name, value) {
			if (value === null) {
				if (el.hasAttribute(name)) el.removeAttribute(name);
			} else if (el.getAttribute(name) !== value) {
				el.setAttribute(name, value);
			}
		}

		/** The row that stays visible when its turn is folded: your message, else the first row. */
		function headOf(list) {
			const own = list.find((row) => {
				const kind = row.getAttribute("data-chat-flow-kind");
				return kind === "user" || kind === "turn-trigger";
			});
			return own ?? list[0];
		}

		/** The scroll box that holds the chat, with the spacer the chat keeps below its last row. */
		function scrollerOf(flow) {
			const scroller = flow.closest("[data-conversation-scroll]");
			if (scroller === null) return null;
			const spacer = scroller.querySelector("[data-chat-turn-spacer]");
			// The chat sizes its spacer through the inline height, so that is the number to subtract.
			const room = spacer === null ? 0 : parseFloat(spacer.style.height) || 0;
			return { scroller, spacer, room, content: scroller.scrollHeight - room };
		}

		function install(ctx) {
			const style = document.createElement("style");
			style.setAttribute("data-dsh-fold-turns", "");
			style.textContent = CSS;
			document.head.appendChild(style);

			const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
			/** Older turns the reader has opened. Every other older turn is folded. */
			const opened = new Set();
			/** Turns whose work-steps disclosure was already closed during the current fold. */
			const processClosed = new Set();
			const controls = new Map();
			const tooltip = element("div", "data-dsh-fold-tooltip");
			tooltip.id = "dsh-fold-turns-usage";
			tooltip.setAttribute("role", "tooltip");
			tooltip.hidden = true;
			document.body.appendChild(tooltip);
			let tooltipEntry = null;
			let hoverTimer = 0;
			let disposed = false;
			let chat = null;
			let sessionKey;
			let disposeChat = () => {};
			const currentSession = ctx.uiSession.adapter.current;
			let lastFlow = null;
			let lastHref = location.href;
			let lastLatest = -1;
			let frame = 0;
			let timer = 0;
			let pinTimer = 0;
			/** Turn whose start is pinned at the top while its reply is still shorter than the screen; -1 for none. */
			let pinned = -1;
			let pinFrame = 0;

			function turnUsage(turn) {
				const snapshot = chat?.getSnapshot();
				const usage = snapshot?.timeline?.turns?.get(turn)?.data?.get("turn-tail")?.tokenUsage;
				return usage && isCount(usage.totalTokens) && isCount(usage.outputTokens) ? usage : undefined;
			}

			function hideTooltip() {
				window.clearTimeout(hoverTimer);
				hoverTimer = 0;
				tooltipEntry?.button.removeAttribute("aria-describedby");
				tooltipEntry = null;
				tooltip.hidden = true;
			}

			function showTooltip(entry) {
				if (!entry.button.isConnected || disposed) return;
				hideTooltip();
				const usage = entry.usage;
				const title = element("div", "data-dsh-fold-tooltip-title");
				title.append(element("span", null, text.title), element("span", null, `${exact(usage?.totalTokens)} tok`));
				const details = document.createElement("dl");
				for (const [label, value] of [["未缓存输入", usage?.uncachedInputTokens], ["缓存读取", usage?.cacheReadTokens], ["缓存写入", usage?.cacheWriteTokens], ["输出", usage?.outputTokens]]) {
					details.append(element("dt", null, label), element("dd", null, exact(value)));
				}
				if (usage?.reasoningTokens !== undefined) details.append(element("dt", null, "其中推理"), element("dd", null, exact(usage.reasoningTokens)));
				const action = element("div", "data-dsh-fold-tooltip-action", `点击${opened.has(entry.turn) ? text.hide : text.show}`);
				tooltip.replaceChildren(title, details, action);
				tooltip.hidden = false;
				const anchor = entry.button.getBoundingClientRect();
				const box = tooltip.getBoundingClientRect();
				const left = Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12));
				const above = anchor.top - box.height - 8;
				const top = above >= 12 ? above : Math.min(anchor.bottom + 8, window.innerHeight - box.height - 12);
				tooltip.style.left = `${left}px`;
				tooltip.style.top = `${Math.max(12, top)}px`;
				tooltipEntry = entry;
				entry.button.setAttribute("aria-describedby", tooltip.id);
			}

			function discardControl(head, entry) {
				if (tooltipEntry === entry) hideTooltip();
				entry.root.remove();
				head.removeAttribute("data-dsh-fold-head");
				head.removeAttribute("data-dsh-fold-label");
				controls.delete(head);
			}

			function updateControl(head, turn, folded, list) {
				let entry = controls.get(head);
				if (!entry) {
					const root = element("div", "data-dsh-fold-control");
					const button = element("button", "data-dsh-fold-button");
					button.type = "button";
					const total = element("span", "data-dsh-fold-total");
					const dot = element("span", "data-dsh-fold-dot", "·");
					dot.setAttribute("aria-hidden", "true");
					const cache = element("span", "data-dsh-fold-cache");
					const chevron = element("span", "data-dsh-fold-chevron");
					chevron.setAttribute("aria-hidden", "true");
					button.append(total, dot, cache, chevron);
					root.appendChild(button);
					entry = { root, button, total, cache, turn, usage: undefined, hovered: false };
					const owned = entry;
					button.addEventListener("click", (event) => {
						event.stopPropagation();
						hideTooltip();
						if (opened.has(owned.turn)) opened.delete(owned.turn);
						else opened.add(owned.turn);
						sync(true);
					});
					button.addEventListener("pointerenter", () => {
						owned.hovered = true;
						window.clearTimeout(hoverTimer);
						hoverTimer = window.setTimeout(() => showTooltip(owned), 300);
					});
					button.addEventListener("pointerleave", () => {
						owned.hovered = false;
						if (document.activeElement !== button) hideTooltip();
					});
					button.addEventListener("focus", () => showTooltip(owned));
					button.addEventListener("blur", () => { if (!owned.hovered) hideTooltip(); });
					controls.set(head, entry);
				}
				entry.turn = turn;
				entry.usage = turnUsage(turn);
				content(entry.total, compact(entry.usage?.totalTokens));
				content(entry.cache, `${text.cache} ${cachePercent(entry.usage)}`);
				setAttr(head, "data-dsh-fold-head", folded ? "closed" : "open");
				setAttr(entry.root, "data-native-process", String(list.some((row) => row.querySelector("button[data-turn-process]") !== null)));
				setAttr(entry.button, "aria-expanded", String(!folded));
				setAttr(entry.button, "aria-label", `${entry.total.textContent}，${entry.cache.textContent}，${folded ? text.show : text.hide}`);
				// Only our own subtree is moved; never replace the native React-owned children.
				if (entry.root.parentElement !== head) head.appendChild(entry.root);
			}

			function bindSession() {
				const binding = currentSession.getSnapshot();
				const nextChat = binding?.hooks?.chat ?? null;
				if (binding?.key === sessionKey && nextChat === chat) return;
				disposeChat();
				hideTooltip();
				for (const [head, entry] of controls) discardControl(head, entry);
				opened.clear();
				processClosed.clear();
				lastFlow = null;
				lastLatest = -1;
				sessionKey = binding?.key;
				chat = nextChat;
				disposeChat = chat?.subscribe(schedule) ?? (() => {});
				schedule();
			}

			/** Slide one row up and out, then hide it. `gap` keeps the neighbours from jumping at the end. */
			function closeRow(row, animate) {
				const state = row.getAttribute("data-dsh-fold");
				if (state === "closed" || state === "closing") return;
				const height = row.offsetHeight;
				if (!animate || height === 0 || reduceMotion.matches || typeof row.animate !== "function") {
					setAttr(row, "data-dsh-fold", "closed");
					return;
				}
				setAttr(row, "data-dsh-fold", "closing");
				const gap = rowGap(row);
				const animation = row.animate([
					{ height: `${height}px`, opacity: 1, transform: "translateY(0)", marginBottom: "0px" },
					{ height: "0px", opacity: 0, transform: "translateY(-24px)", marginBottom: `${-gap}px` },
				], { duration: SLIDE_MS, easing: "ease-in-out", fill: "forwards" });
				const done = () => {
					animation.cancel();
					if (row.getAttribute("data-dsh-fold") === "closing") setAttr(row, "data-dsh-fold", "closed");
				};
				animation.onfinish = done;
				animation.oncancel = () => {
					if (row.getAttribute("data-dsh-fold") === "closing") setAttr(row, "data-dsh-fold", "closed");
				};
			}

			/** Bring a row back. Only rows that were fully hidden fade in. */
			function openRow(row, animate) {
				const state = row.getAttribute("data-dsh-fold");
				if (state === null) return;
				for (const running of row.getAnimations?.() ?? []) running.cancel();
				setAttr(row, "data-dsh-fold", null);
				if (animate && state === "closed" && !reduceMotion.matches && typeof row.animate === "function") {
					row.animate([
						{ opacity: 0, transform: "translateY(-8px)" },
						{ opacity: 1, transform: "translateY(0)" },
					], { duration: FADE_MS, easing: "ease-out" });
				}
			}

			/** Fold the work steps back up if the reader had opened them, so the reopened turn starts tidy. */
			function closeProcess(turn, list) {
				if (processClosed.has(turn)) return;
				processClosed.add(turn);
				for (const row of list) {
					const button = row.querySelector(PROCESS_OPEN_SELECTOR);
					if (button !== null) button.click();
				}
			}

			/**
			 * Scroll the chat so the newest turn starts at the top edge: the folded older turns glide up
			 * and out of view (they stay above; scroll up to reach them). The chat keeps a spacer below
			 * its last row for exactly this; it is grown just enough to allow the scroll. Skipped when the
			 * turn is already long enough that the normal follow-the-tail scroll pushes them out anyway.
			 */
			function pinLatest(turn) {
				pinTimer = 0;
				const flow = document.querySelector(FLOW_SELECTOR);
				if (flow === null || flow !== lastFlow || lastLatest !== turn) return;
				const box = scrollerOf(flow);
				if (box === null) return;
				const rows = topRows(flow);
				const head = rows.find((row) => Number(row.getAttribute("data-chat-turn")) === turn);
				if (head === undefined) return;
				const { scroller, spacer, content } = box;
				// Keep a little air above your message, but never so much that the line above peeks in.
				const above = rows.slice(0, rows.indexOf(head)).reverse().find((row) => row.offsetHeight > 0);
				const seam = above === undefined ? 0 : head.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
				const edge = scroller.getBoundingClientRect().top + Math.max(0, Math.min(PIN_GAP, seam - 2));
				const want = Math.round(scroller.scrollTop + head.getBoundingClientRect().top - edge);
				if (want <= scroller.scrollTop + 1) return;
				if (content - scroller.clientHeight >= want) return;
				pinned = turn;
				const from = scroller.scrollTop;
				const begin = performance.now();
				const duration = reduceMotion.matches ? 0 : PIN_MS;
				// Drive the scroll frame by frame and top up the spacer on every frame: the chat gives spare
				// spacer back whenever a scroll ends, which would otherwise cut the target out from under us.
				const step = (now) => {
					pinFrame = 0;
					if (pinned !== turn || !head.isConnected) return;
					const t = duration === 0 ? 1 : Math.min(1, (now - begin) / duration);
					if (spacer !== null) {
						// Leave slack below the target: landing exactly on the floor reads as "reader reached the bottom".
						const short = want + PIN_SLACK - (scroller.scrollHeight - scroller.clientHeight);
						if (short > 0) spacer.style.height = `${Math.ceil((parseFloat(spacer.style.height) || 0) + short)}px`;
					}
					scroller.scrollTop = from + (want - from) * (1 - (1 - t) ** 3);
					if (t < 1) pinFrame = window.requestAnimationFrame(step);
				};
				step(begin);
			}

			/** Once the pinned reply outgrows the screen, go back to following its tail like the chat normally does. */
			function releasePin(flow, latest) {
				if (pinned === -1) return;
				if (pinned !== latest) {
					pinned = -1;
					return;
				}
				if (pinTimer !== 0 || pinFrame !== 0) return;
				const box = scrollerOf(flow);
				if (box === null) return;
				const { scroller, content } = box;
				const bottom = content - scroller.clientHeight;
				if (bottom <= scroller.scrollTop + 2) return;
				pinned = -1;
				scroller.scrollTo({ top: bottom, behavior: "auto" });
			}

			/** The reader took over the scroll: stop steering it. */
			function onIntent(event) {
				if (event.type === "keydown") {
					const target = event.target;
					if (target instanceof Element && target.closest("input, textarea, [contenteditable]") !== null) return;
				}
				pinned = -1;
			}

			function sync(byClick = false) {
				frame = 0;
				const flow = document.querySelector(FLOW_SELECTOR);
				if (flow === null) return;
				if (flow !== lastFlow || location.href !== lastHref) {
					opened.clear();
					processClosed.clear();
					lastFlow = flow;
					lastHref = location.href;
					lastLatest = -1;
				}
				const byTurn = new Map();
				let latest = -1;
				for (const row of topRows(flow)) {
					const turn = Number(row.getAttribute("data-chat-turn"));
					if (!Number.isFinite(turn)) continue;
					const list = byTurn.get(turn);
					if (list === undefined) byTurn.set(turn, [row]);
					else list.push(row);
					if (turn > latest) latest = turn;
				}
				// Slide only when a newer turn appears while the page is live; history loads fold at once.
				const newTurn = lastLatest !== -1 && latest > lastLatest;
				if (latest < lastLatest) {
					opened.clear();
					processClosed.clear();
				}
				lastLatest = latest;
				for (const turn of [...opened]) if (!byTurn.has(turn)) opened.delete(turn);
				for (const turn of [...processClosed]) if (!byTurn.has(turn)) processClosed.delete(turn);

				const heads = new Set();
				for (const [turn, list] of byTurn) {
					const head = headOf(list);
					const old = turn !== latest;
					const folded = old && !opened.has(turn);
					if (old) {
						heads.add(head);
						updateControl(head, turn, folded, list);
					}
					if (folded) closeProcess(turn, list);
					else processClosed.delete(turn);
					for (const row of list) {
						if (row === head) continue;
						if (folded) closeRow(row, newTurn || byClick);
						else openRow(row, byClick);
					}
				}
				releasePin(flow, latest);
				if (newTurn) {
					if (pinTimer !== 0) window.clearTimeout(pinTimer);
					pinTimer = window.setTimeout(() => pinLatest(latest), reduceMotion.matches ? 0 : SLIDE_MS + 60);
				}
				// Rows that lost their header role (the newest turn, or a turn that is gone).
				for (const [stale, entry] of controls) {
					if (heads.has(stale)) continue;
					discardControl(stale, entry);
				}
			}

			/** Coalesce bursts of streaming mutations into at most one pass per ~100 ms. */
			function schedule() {
				if (disposed || frame !== 0 || timer !== 0) return;
				timer = window.setTimeout(() => {
					timer = 0;
					frame = window.requestAnimationFrame(() => sync());
				}, 100);
			}

			function onKey(event) { if (event.key === "Escape") hideTooltip(); }
			const observer = new MutationObserver((records) => {
				if (records.some((record) => !record.target.parentElement?.closest("[data-dsh-fold-control],[data-dsh-fold-tooltip]") && !(record.target instanceof Element && record.target.matches("[data-dsh-fold-control],[data-dsh-fold-tooltip]")))) schedule();
			});
			observer.observe(document.body, { childList: true, characterData: true, subtree: true });
			const disposeSession = currentSession.subscribe(bindSession);
			bindSession();
			document.addEventListener("keydown", onKey);
			document.addEventListener("scroll", hideTooltip, { passive: true, capture: true });
			window.addEventListener("resize", hideTooltip);
			for (const type of INTENTS) document.addEventListener(type, onIntent, { passive: true, capture: true });
			window.addEventListener("popstate", schedule);
			schedule();

			return () => {
				disposed = true;
				disposeSession();
				disposeChat();
				hideTooltip();
				observer.disconnect();
				document.removeEventListener("keydown", onKey);
				document.removeEventListener("scroll", hideTooltip, true);
				window.removeEventListener("resize", hideTooltip);
				for (const type of INTENTS) document.removeEventListener(type, onIntent, { capture: true });
				window.removeEventListener("popstate", schedule);
				if (timer !== 0) window.clearTimeout(timer);
				if (pinTimer !== 0) window.clearTimeout(pinTimer);
				if (pinFrame !== 0) window.cancelAnimationFrame(pinFrame);
				for (const [head, entry] of controls) discardControl(head, entry);
				if (frame !== 0) window.cancelAnimationFrame(frame);
				for (const el of document.querySelectorAll("[data-dsh-fold]")) el.removeAttribute("data-dsh-fold");
				for (const el of document.querySelectorAll("[data-dsh-fold-head]")) {
					el.removeAttribute("data-dsh-fold-head");
					el.removeAttribute("data-dsh-fold-label");
				}
				style.remove();
				tooltip.remove();
			};
		}

		/** Current main-session snapshot; ui-chat supplies its exact completed-turn usage. */
		const inject = ["uiSession"];

		function apply(ctx) {
			ctx.effect(() => install(ctx), "fold-turns: per-turn usage and reply folding");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
