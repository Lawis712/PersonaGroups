/**
 * SillyTavern Persona Groups (用户人设分组)
 * Copyright (C) 2026  Lavi
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * ---
 * Based on / inspired by the Quick Persona extension from SillyTavern
 * (part of the SillyTavern project, https://github.com/SillyTavern/Extension-QuickPersona.git)
 * Licensed under AGPL-3.0
 */

import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';

const EXT_NAME = 'Persona Groups';
const EXT_DISPLAY = '用户人设分组';
const KEY = 'persona_groups';
const TOOLBAR_ID = 'pg-toolbar-container';
const PAGER_ID = 'pg-pager';
const BTN_ID = 'pg-quick-btn';
const POPUP_ID = 'pg-quick-popup';
const SETTINGS_ID = 'pg-extension-settings';

// ========== 存储 ==========
function initStorage() {
    if (!extension_settings[KEY]) {
        extension_settings[KEY] = {
            groups: [],
            pageSize: 20,
            version: 3,
            groupsHidden: false,
            quickEnabled: true,
        };
        saveSettingsDebounced();
    }
    const s = extension_settings[KEY];
    if (!s.groups) s.groups = [];
    if (!s.pageSize) s.pageSize = 20;
    if (typeof s.groupsHidden !== 'boolean') s.groupsHidden = false;
    if (typeof s.quickEnabled !== 'boolean') s.quickEnabled = true;
    // 清理历史废弃字段（排序 / 置顶）
    if ('sortEnabled' in s) delete s.sortEnabled;
    if ('ungroupedOrder' in s) delete s.ungroupedOrder;
    if ('pinned' in s) delete s.pinned;
    s.version = 3;
    saveSettingsDebounced();
}
function getGroups() { return extension_settings[KEY].groups; }
function getPageSize() { return extension_settings[KEY].pageSize || 20; }
function setPageSize(n) { extension_settings[KEY].pageSize = n; saveSettingsDebounced(); }
function isGroupsHidden() { return !!extension_settings[KEY].groupsHidden; }
function setGroupsHidden(v) { extension_settings[KEY].groupsHidden = !!v; saveSettingsDebounced(); }
function isQuickEnabled() { return !!extension_settings[KEY].quickEnabled; }
function setQuickEnabled(v) { extension_settings[KEY].quickEnabled = !!v; saveSettingsDebounced(); }
function saveGroups() { saveSettingsDebounced(); }
function createGroup(name) {
    const id = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    getGroups().push({ id, name: name || '新分组', collapsed: false, personas: [] });
    saveGroups();
}
function renameGroup(id, n) { const g = getGroups().find(x => x.id === id); if (g) { g.name = n; saveGroups(); } }
function deleteGroup(id) { const gs = getGroups(); const i = gs.findIndex(x => x.id === id); if (i >= 0) { gs.splice(i, 1); saveGroups(); } }
function setCollapsed(id, v) { const g = getGroups().find(x => x.id === id); if (g) { g.collapsed = !!v; saveGroups(); } }
function isCollapsed(id) { const g = getGroups().find(x => x.id === id); return g ? !!g.collapsed : false; }
function movePersonas(avatars, targetId) {
    for (const g of getGroups()) g.personas = g.personas.filter(a => !avatars.includes(a));
    if (targetId) {
        const t = getGroups().find(x => x.id === targetId);
        if (t) for (const a of avatars) if (!t.personas.includes(a)) t.personas.push(a);
    }
    saveGroups();
}

// ========== 缓存 ==========
let _validAvatars = null;
let _validAvatarsSet = null;
let _lastAvatarRefresh = 0;
let _aidCache = new WeakMap();   // element -> avatarId
let _boundCache = new Map();     // avatar -> bool
let _searchIndex = new Map();    // avatar -> lowercase blob
let _lastSig = '';               // 列表内容签名，用于跳过无意义的重排

function invalidateCaches() {
    _aidCache = new WeakMap();
    _boundCache.clear();
    _searchIndex.clear();
}

async function refreshValidAvatars(force = false) {
    const now = Date.now();
    if (!force && _validAvatars && (now - _lastAvatarRefresh) < 1500) return;
    _lastAvatarRefresh = now;
    await loadPersonaApi();
    if (_getUserAvatars) {
        try {
            const list = await _getUserAvatars(false);
            if (Array.isArray(list)) {
                _validAvatars = list;
                _validAvatarsSet = new Set(list);
                invalidateCaches();
                return;
            }
        } catch (e) {
            console.warn('[' + EXT_NAME + '] getUserAvatars failed:', e);
        }
    }
    const personas = power_user.personas || {};
    _validAvatars = Object.keys(personas).filter(key => {
        if (!/[.\-_]/.test(key) && !/^\d/.test(key)) return false;
        const name = personas[key];
        if (typeof name === 'string' && (name.length > 200 || name.includes('\n'))) return false;
        return true;
    });
    _validAvatarsSet = new Set(_validAvatars);
    invalidateCaches();
}

function getAllAvatars() {
    if (_validAvatars) return _validAvatars;
    const personas = power_user.personas || {};
    return Object.keys(personas).filter(key => {
        if (!/[.\-_]/.test(key) && !/^\d/.test(key)) return false;
        const name = personas[key];
        if (typeof name === 'string' && (name.length > 200 || name.includes('\n'))) return false;
        return true;
    });
}

function isValidAvatar(a) {
    if (_validAvatarsSet) return _validAvatarsSet.has(a);
    return true;
}

function getName(a) {
    const raw = (power_user.personas || {})[a];
    if (typeof raw !== 'string') return a;
    if (raw.length > 200 || raw.includes('\n')) return a;
    return raw || a;
}
function getAvatarUrl(a) { return '/thumbnail?type=persona&file=' + encodeURIComponent(a); }

function getPersonaTitle(a) {
    const desc = (power_user.persona_descriptions || {})[a];
    if (!desc) return '';
    return (typeof desc.title === 'string') ? desc.title : '';
}
function getPersonaDescription(a) {
    const desc = (power_user.persona_descriptions || {})[a];
    if (!desc) return '';
    return (typeof desc.description === 'string') ? desc.description : '';
}

function isBound(a) {
    if (_boundCache.has(a)) return _boundCache.get(a);
    let result = false;
    const desc = (power_user.persona_descriptions || {})[a];
    if (desc) {
        if (desc.position === 'character') result = true;
        else if (Array.isArray(desc.connections) && desc.connections.length > 0) result = true;
        else if (Array.isArray(desc.lockedFor) && desc.lockedFor.length > 0) result = true;
    }
    if (!result) {
        const lockObjs = [power_user.personas_lock, power_user.lockedPersonas, power_user.persona_lock];
        for (const lock of lockObjs) {
            if (!lock || typeof lock !== 'object') continue;
            if (lock[a] !== undefined && lock[a] !== null && lock[a] !== '') { result = true; break; }
            let hit = false;
            for (const k in lock) if (lock[k] === a) { hit = true; break; }
            if (hit) { result = true; break; }
        }
    }
    if (!result && Array.isArray(power_user.persona_locked_chats) && power_user.persona_locked_chats.includes(a)) {
        result = true;
    }
    _boundCache.set(a, result);
    return result;
}

// 缓存版，避免一轮渲染里成百上千次 querySelector
function getCardAvatarId(card) {
    if (!card) return null;
    const cached = _aidCache.get(card);
    if (cached !== undefined) return cached;
    let id = null;
    const inner = card.querySelector('.avatar[data-avatar-id]') || card.querySelector('[data-avatar-id]');
    if (inner && inner.dataset.avatarId) id = inner.dataset.avatarId;
    else if (card.dataset && card.dataset.avatarId) id = card.dataset.avatarId;
    _aidCache.set(card, id);
    return id;
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function getFilterGroupId() {
    if (!state.filter || !state.filter.startsWith('group:')) return null;
    return state.filter.slice('group:'.length);
}

function isStQuickPersonaEnabled() {
    const qp = extension_settings.quickPersona;
    return !!(qp && qp.enabled === true);
}

// 搜索索引：一次小写化，之后每次敲键只做 includes
function getSearchBlob(avatar) {
    let blob = _searchIndex.get(avatar);
    if (blob === undefined) {
        blob = (getName(avatar) + '\n' + getPersonaTitle(avatar) + '\n' +
            getPersonaDescription(avatar) + '\n' + avatar).toLowerCase();
        _searchIndex.set(avatar, blob);
    }
    return blob;
}
function matchesSearch(avatar, query) {
    if (!query) return true;
    return getSearchBlob(avatar).includes(query.toLowerCase());
}

function setShown(el, shown) {
    const want = shown ? '' : 'none';
    if (el.style.display !== want) el.style.display = want;
}

// 列表内容签名：内容没变就不重排（切换人设时省掉整轮重绘）
function computeListSignature() {
    const avatars = getAllAvatars();
    let sig = 'n' + avatars.length + '|f' + state.filter + '|p' + state.page
        + '|s' + getPageSize() + '|h' + (isGroupsHidden() ? 1 : 0) + '|q' + state.search.trim();
    for (const g of getGroups()) sig += '|' + g.id + ':' + g.name + ':' + g.personas.length;
    for (const a of avatars) sig += '|' + a + '=' + getName(a) + '#' + getPersonaTitle(a);
    return sig;
}

// ========== 懒加载兼容层 ==========
// 其他插件（图片懒加载类）会把真实地址搬到 data-src 等属性，把 src 换成透明占位图，
// 再用 IntersectionObserver 还原。两个问题：
//   1) 克隆卡片会继承模板卡的 data-src，被“还原”成同一张头像
//   2) 它和我们互相改写 src，造成抖动
// 对策：清理懒加载属性 + 用 background-image 兜底（src 被换掉也不影响观感）+ 纠正次数上限
const LAZY_ATTR_RE = /^data-.*(lazy|src|origin|echo|defer|thumb)/i;

function ensureAvatarPaint(img, url) {
    if (img.dataset.pgPainted === url) return;
    img.dataset.pgPainted = url;
    img.style.backgroundImage = 'url("' + url + '")';
    img.style.backgroundSize = 'cover';
    img.style.backgroundPosition = 'center';
    img.style.backgroundRepeat = 'no-repeat';
}

function sanitizeLazyImg(img, url) {
    for (const attr of Array.from(img.attributes)) {
        if (LAZY_ATTR_RE.test(attr.name)) img.removeAttribute(attr.name);
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    if (img.classList && img.classList.length) {
        Array.from(img.classList).forEach(cls => {
            if (/lazy/i.test(cls)) img.classList.remove(cls);
        });
    }
    img.setAttribute('loading', 'eager');
    img.dataset.pgNoLazy = '1';
    if (url) {
        ensureAvatarPaint(img, url);
        img.src = url;
    }
}

function imgSrcMatchesAvatar(img, avatar) {
    const src = img.getAttribute('src');
    if (!src) return false;
    let dec = src;
    try { dec = decodeURIComponent(src); } catch (e) { /* 保持原值 */ }
    return dec.includes(avatar);
}

// 修单张图，带循环保护：3 秒内同一张最多纠正 3 次，避免与懒加载插件互改死循环
function repairOneImg(img) {
    const card = img.closest ? img.closest('.avatar-container') : null;
    if (!card) return false;
    if (card.style.display === 'none') return false;
    const avatar = getCardAvatarId(card);
    if (!avatar) return false;
    if (imgSrcMatchesAvatar(img, avatar)) return false;

    const now = Date.now();
    const last = Number(img.dataset.pgFixAt || 0);
    let n = Number(img.dataset.pgFixN || 0);
    if (now - last > 3000) n = 0;
    if (n >= 3) {
        // 放弃抢 src，靠背景图保证显示正确
        ensureAvatarPaint(img, getAvatarUrl(avatar));
        return false;
    }
    img.dataset.pgFixAt = String(now);
    img.dataset.pgFixN = String(n + 1);

    sanitizeLazyImg(img, getAvatarUrl(avatar));
    return true;
}

function repairAvatarImages(block) {
    if (!block) return 0;
    let fixed = 0;
    block.querySelectorAll('.avatar-container img').forEach(img => {
        if (repairOneImg(img)) fixed++;
    });
    if (fixed && window.__pgDebug) console.log('[' + EXT_NAME + '] repaired ' + fixed + ' avatar image(s)');
    return fixed;
}

// 给可见卡片铺背景兜底（有 pgPainted 标记，重复调用几乎零成本）
function paintVisibleCards(cards) {
    for (const card of cards) {
        if (card.style.display === 'none') continue;
        const id = getCardAvatarId(card);
        if (!id) continue;
        const url = getAvatarUrl(id);
        card.querySelectorAll('img').forEach(img => ensureAvatarPaint(img, url));
    }
}

// ========== ST API ==========
let _setUserAvatar = null;
let _getUserAvatars = null;
let _Popper = null;

async function loadPersonaApi() {
    if (_setUserAvatar) return;
    try {
        const m = await import('/scripts/personas.js');
        _setUserAvatar = m.setUserAvatar;
        _getUserAvatars = m.getUserAvatars;
    } catch (e) {
        console.warn('[' + EXT_NAME + '] Cannot load personas.js:', e);
    }
}
async function loadPopper() {
    if (_Popper !== null) return _Popper;
    try {
        const m = await import('/lib.js');
        _Popper = m.Popper || false;
    } catch (e) {
        _Popper = false;
        console.warn('[' + EXT_NAME + '] Popper not available, using manual positioning.');
    }
    return _Popper;
}
async function switchPersona(avatar) {
    await loadPersonaApi();
    if (_setUserAvatar) {
        try { await _setUserAvatar(avatar); return; }
        catch (e) { console.warn('[' + EXT_NAME + '] setUserAvatar failed:', e); }
    }
    const candidates = document.querySelectorAll('#user_avatar_block .avatar-container');
    for (const c of candidates) {
        if (getCardAvatarId(c) === avatar) {
            if (window.jQuery) window.jQuery(c).trigger('click');
            else c.click();
            return;
        }
    }
}

const state = { selectMode: false, selected: new Set(), filter: 'all', page: 0, search: '' };
let isReorganizing = false;

function isPanelVisible() {
    const block = document.getElementById('user_avatar_block');
    return !!(block && block.offsetParent !== null);
}
let _pendingRefresh = false;
let _visibilityTimer = null;
function markPendingRefresh() {
    _pendingRefresh = true;
    if (_visibilityTimer) return;
    _visibilityTimer = setInterval(() => {
        if (!_pendingRefresh) { clearInterval(_visibilityTimer); _visibilityTimer = null; return; }
        if (isPanelVisible()) {
            _pendingRefresh = false;
            clearInterval(_visibilityTimer);
            _visibilityTimer = null;
            refreshMain();
        }
    }, 600);
}

// ========== 扩展设置面板 ==========
function initExtensionSettings() {
    const container = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!container) {
        setTimeout(initExtensionSettings, 500);
        return;
    }
    if (document.getElementById(SETTINGS_ID)) return;

    const $panel = window.jQuery(`
        <div id="${SETTINGS_ID}" class="pg-extension-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${EXT_DISPLAY}</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="pg-setting-row">
                        <label class="checkbox_label" for="pg-setting-quick-enabled">
                            <input type="checkbox" id="pg-setting-quick-enabled">
                            <span>启用快捷弹窗（输入栏旁边的小头像）</span>
                        </label>
                        <small class="pg-setting-hint" id="pg-setting-quick-hint" style="display:none; opacity:0.7; margin-top:4px; font-style:italic;"></small>
                    </div>
                </div>
            </div>
        </div>
    `);
    window.jQuery(container).append($panel);

    const $cb = $panel.find('#pg-setting-quick-enabled');
    const $hint = $panel.find('#pg-setting-quick-hint');

    function updateUI() {
        const enabled = isQuickEnabled();
        const stQpOn = isStQuickPersonaEnabled();
        $cb.prop('checked', enabled);
        if (stQpOn) {
            $cb.prop('disabled', true);
            $hint.text('⚠️ 检测到酒馆自带的 Quick Persona 扩展已启用，本插件的快捷弹窗已自动禁用以避免冲突。如需启用本插件的快捷弹窗，请先在扩展面板中关闭 Quick Persona。').show();
        } else {
            $cb.prop('disabled', false);
            $hint.hide();
        }
    }

    $cb.on('change', function () {
        const v = $(this).prop('checked');
        setQuickEnabled(v);
        if (v && !isStQuickPersonaEnabled()) initQuick();
        else removeQuickBtn();
    });

    updateUI();

    if (eventSource && event_types && event_types.SETTINGS_UPDATED) {
        eventSource.on(event_types.SETTINGS_UPDATED, () => {
            updateUI();
            const shouldShow = isQuickEnabled() && !isStQuickPersonaEnabled();
            const exists = !!document.getElementById(BTN_ID);
            if (shouldShow && !exists) initQuick();
            if (!shouldShow && exists) removeQuickBtn();
        });
    }
}

function removeQuickBtn() {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();
    const popup = document.getElementById(POPUP_ID);
    if (popup) popup.remove();
    if (_popperInstance) {
        try { _popperInstance.destroy(); } catch (e) {}
        _popperInstance = null;
    }
}

// ========== 位置1：工具栏 + 重组原生 DOM ==========
function initMainPanel() {
    const tryInject = () => {
        const native = document.getElementById('user_avatar_block');
        if (!native) { setTimeout(tryInject, 500); return; }
        if (!document.getElementById(TOOLBAR_ID)) {
            const toolbar = document.createElement('div');
            toolbar.id = TOOLBAR_ID;
            toolbar.className = 'pg-toolbar-container';
            native.parentElement.insertBefore(toolbar, native);
        }
        if (!document.getElementById(PAGER_ID)) {
            const pager = document.createElement('div');
            pager.id = PAGER_ID;
            pager.className = 'pg-pager';
            const toolbar = document.getElementById(TOOLBAR_ID);
            toolbar.parentElement.insertBefore(pager, toolbar.nextSibling);
        }
        hideNativePagination();
        hijackNativeSearch();
        renderToolbar();
        reorganizeNative();
    };
    tryInject();
}

function hideNativePagination() {
    const block = document.getElementById('user_avatar_block');
    if (!block) return;
    const col = block.parentElement;
    col.querySelectorAll('.paginationjs, .nav-tabs-paging, [class*="pagination"]').forEach(el => {
        el.classList.add('pg-hide-native-pager');
    });
}

let _searchDebounceTimer = null;
function hijackNativeSearch() {
    const searchInput = document.getElementById('persona_search_bar');
    if (!searchInput) return;
    if (searchInput.dataset.pgHijacked === '1') return;
    searchInput.dataset.pgHijacked = '1';

    const handler = (e) => {
        e.stopImmediatePropagation();
        const val = searchInput.value || '';
        clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => {
            state.search = val;
            state.page = 0;
            reorganizeNative();
        }, 150);
    };
    searchInput.addEventListener('input', handler, true);
    searchInput.addEventListener('change', handler, true);

    state.search = searchInput.value || '';
}

function refreshMain() {
    const t = document.getElementById(TOOLBAR_ID);
    if (t) renderToolbar();
    reorganizeNative();
}

function renderToolbar() {
    const t = document.getElementById(TOOLBAR_ID);
    if (!t) return;
    const hidden = isGroupsHidden();

    const currentGroupId = getFilterGroupId();
    if (currentGroupId && !getGroups().find(g => g.id === currentGroupId)) {
        state.filter = 'all';
    }

    let html = '<div class="pg-toolbar">';
    html += '<select class="pg-filter">';
    html += '<option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>全部</option>';
    html += '<option value="bound"' + (state.filter === 'bound' ? ' selected' : '') + '>已绑定</option>';
    html += '<option value="unbound"' + (state.filter === 'unbound' ? ' selected' : '') + '>未绑定</option>';

    const groups = getGroups();
    if (groups.length > 0) {
        html += '<optgroup label="───୨ৎ─按分组─୨ৎ───">';
        for (const g of groups) {
            const v = 'group:' + g.id;
            html += '<option value="' + esc(v) + '"' + (state.filter === v ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }
        html += '</optgroup>';
    }

    html += '</select>';
    html += '<button class="menu_button pg-btn-newgroup" title="新建分组"><i class="fa-solid fa-folder-plus"></i></button>';
    html += '<button class="menu_button pg-btn-selectmode' + (state.selectMode ? ' pg-active' : '') + '" title="多选模式"><i class="fa-solid fa-check-double"></i></button>';
    html += '<button class="menu_button pg-btn-toggle-groups' + (hidden ? ' pg-active' : '') + '" title="' + (hidden ? '显示分组' : '隐藏分组') + '"><i class="fa-solid ' + (hidden ? 'fa-eye-slash' : 'fa-eye') + '"></i></button>';
    html += '</div>';

    if (state.selectMode) {
        html += '<div class="pg-selection-bar">';
        html += '<span>已选 <b>' + state.selected.size + '</b></span>';
        html += '<select class="pg-move-target"><option value="">— 移到分组 —</option>';
        for (const g of getGroups()) html += '<option value="' + g.id + '">' + esc(g.name) + '</option>';
        html += '<option value="__ungroup__">↓ 移出（未分组）</option></select>';
        html += '<button class="menu_button pg-btn-move">应用</button>';
        html += '<button class="menu_button pg-btn-clear-sel">清空</button>';
        html += '</div>';
    }

    t.innerHTML = html;
    bindToolbar(t);
}

function bindToolbar(t) {
    const filter = t.querySelector('.pg-filter');
    if (filter) filter.addEventListener('change', e => { state.filter = e.target.value; state.page = 0; refreshMain(); });
    const ng = t.querySelector('.pg-btn-newgroup');
    if (ng) ng.addEventListener('click', () => {
        const n = prompt('新分组名称：', '新分组');
        if (n && n.trim()) { createGroup(n.trim()); refreshMain(); }
    });
    const sm = t.querySelector('.pg-btn-selectmode');
    if (sm) sm.addEventListener('click', () => {
        state.selectMode = !state.selectMode;
        state.selected.clear();
        refreshMain();
    });
    const tg = t.querySelector('.pg-btn-toggle-groups');
    if (tg) tg.addEventListener('click', () => {
        setGroupsHidden(!isGroupsHidden());
        state.page = 0;
        refreshMain();
    });

    if (state.selectMode) {
        const cb = t.querySelector('.pg-btn-clear-sel');
        if (cb) cb.addEventListener('click', () => { state.selected.clear(); refreshMain(); });
        const mb = t.querySelector('.pg-btn-move');
        if (mb) mb.addEventListener('click', () => {
            const v = t.querySelector('.pg-move-target').value;
            if (!v) return;
            const arr = [...state.selected];
            movePersonas(arr, v === '__ungroup__' ? null : v);
            state.selected.clear();
            refreshMain();
        });
    }
}

function renderPager(totalPages) {
    const p = document.getElementById(PAGER_ID);
    if (!p) return;
    if (totalPages <= 0) { p.innerHTML = ''; return; }
    if (state.page >= totalPages) state.page = totalPages - 1;
    if (state.page < 0) state.page = 0;
    const pageSize = getPageSize();
    const isFirst = state.page === 0;
    const isLast = state.page >= totalPages - 1;

    let html = '<div class="pg-pager-inner">';
    html += '<button class="menu_button pg-pager-first pg-pager-edge"' + (isFirst ? ' disabled' : '') + ' title="首页"><i class="fa-solid fa-angles-left"></i></button>';
    html += '<button class="menu_button pg-pager-prev"' + (isFirst ? ' disabled' : '') + ' title="上一页"><i class="fa-solid fa-chevron-left"></i></button>';
    html += '<span class="pg-pager-info">' + (state.page + 1) + '/' + totalPages + '</span>';
    html += '<button class="menu_button pg-pager-next"' + (isLast ? ' disabled' : '') + ' title="下一页"><i class="fa-solid fa-chevron-right"></i></button>';
    html += '<button class="menu_button pg-pager-last pg-pager-edge"' + (isLast ? ' disabled' : '') + ' title="末页"><i class="fa-solid fa-angles-right"></i></button>';
    html += '<select class="pg-pager-size" title="每页数量">';
    [5, 10, 25, 50, 100, 200].forEach(n => {
        html += '<option value="' + n + '"' + (pageSize === n ? ' selected' : '') + '>' + n + '</option>';
    });
    html += '</select>';
    html += '</div>';
    p.innerHTML = html;

    const first = p.querySelector('.pg-pager-first');
    if (first) first.addEventListener('click', () => { state.page = 0; reorganizeNative(); });
    const prev = p.querySelector('.pg-pager-prev');
    if (prev) prev.addEventListener('click', () => { state.page--; reorganizeNative(); });
    const next = p.querySelector('.pg-pager-next');
    if (next) next.addEventListener('click', () => { state.page++; reorganizeNative(); });
    const last = p.querySelector('.pg-pager-last');
    if (last) last.addEventListener('click', () => { state.page = totalPages - 1; reorganizeNative(); });
    const size = p.querySelector('.pg-pager-size');
    if (size) size.addEventListener('change', e => {
        setPageSize(parseInt(e.target.value, 10));
        state.page = 0;
        reorganizeNative();
    });
}

function unwrapGroups(block) {
    block.querySelectorAll(':scope > .pg-group-wrapper').forEach(w => {
        const body = w.querySelector('.pg-group-body');
        if (body) {
            Array.from(body.children).forEach(child => {
                if (child.classList.contains('avatar-container')) block.appendChild(child);
            });
        }
        w.remove();
    });
    block.querySelectorAll(':scope > .pg-empty-hint').forEach(el => el.remove());
}

async function reorganizeNative() {
    const block = document.getElementById('user_avatar_block');
    if (!block) return;

    const scrollContainer = document.getElementById('PersonaManagement');
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    invalidateCaches();
    if (!_validAvatars) await refreshValidAvatars(true);

    // 搜索模式：展平显示，不分组不分页
    if (state.search.trim()) {
        isReorganizing = true;
        try {
            unwrapGroups(block);
            await ensureAllCardsInDom();

            const q = state.search.trim();
            const cards = Array.from(block.querySelectorAll(':scope > .avatar-container'));
            cards.forEach(c => {
                const id = getCardAvatarId(c);
                setShown(c, !!id && matchesSearch(id, q));
            });

            paintVisibleCards(cards);
            applySelectModeUI();
            const pager = document.getElementById(PAGER_ID);
            if (pager) pager.style.display = 'none';
        } finally {
            _lastSig = computeListSignature();
            requestAnimationFrame(() => {
                isReorganizing = false;
                if (scrollContainer && savedScrollTop > 0) scrollContainer.scrollTop = savedScrollTop;
            });
        }
        return;
    }

    const pager = document.getElementById(PAGER_ID);
    if (pager) pager.style.display = '';

    isReorganizing = true;
    try {
        unwrapGroups(block);
        await ensureAllCardsInDom();

        const allCards = Array.from(block.querySelectorAll(':scope > .avatar-container'));
        const cardMap = new Map();
        for (const c of allCards) {
            const id = getCardAvatarId(c);
            if (id && isValidAvatar(id) && !cardMap.has(id)) cardMap.set(id, c);
        }

        const filterGroupId = getFilterGroupId();
        const isFilteringByGroup = !!filterGroupId;
        const hidden = isGroupsHidden();

        const passFilter = (avatar) => {
            if (isFilteringByGroup) return true;
            if (state.filter === 'bound' && !isBound(avatar)) return false;
            if (state.filter === 'unbound' && isBound(avatar)) return false;
            return true;
        };

        const groups = getGroups();
        const groupedSet = new Set();
        for (const g of groups) g.personas.forEach(a => groupedSet.add(a));
        const allAvatars = getAllAvatars().filter(a => cardMap.has(a));
        const ungroupedAvatars = allAvatars.filter(a => !groupedSet.has(a));

        let pageItemsForDisplay = [];
        let totalPages = 1;
        const pageSize = getPageSize();
        // 先算出该显示哪些卡，最后统一切 display，避免“全隐藏再全显示”的抖动
        const shouldShow = new Set();

        if (isFilteringByGroup) {
            const targetGroup = groups.find(g => g.id === filterGroupId);
            const groupAvatars = targetGroup ? targetGroup.personas.filter(a => cardMap.has(a)) : [];
            totalPages = Math.max(1, Math.ceil(groupAvatars.length / pageSize));
            if (state.page >= totalPages) state.page = totalPages - 1;
            if (state.page < 0) state.page = 0;
            const start = state.page * pageSize;
            pageItemsForDisplay = groupAvatars.slice(start, start + pageSize);
            pageItemsForDisplay.forEach(a => shouldShow.add(a));
        } else {
            const ungroupedFiltered = ungroupedAvatars.filter(passFilter);
            totalPages = Math.max(1, Math.ceil(ungroupedFiltered.length / pageSize));
            if (state.page >= totalPages) state.page = totalPages - 1;
            if (state.page < 0) state.page = 0;
            const start = state.page * pageSize;
            pageItemsForDisplay = ungroupedFiltered.slice(start, start + pageSize);
            pageItemsForDisplay.forEach(a => shouldShow.add(a));

            if (!hidden) {
                const fragment = document.createDocumentFragment();
                for (const g of groups) {
                    const visibleInGroup = g.personas.filter(a => cardMap.has(a) && passFilter(a));
                    const totalPersonasInGroup = g.personas.filter(a => cardMap.has(a)).length;
                    if (totalPersonasInGroup > 0 && visibleInGroup.length === 0) continue;

                    const wrapper = document.createElement('div');
                    wrapper.className = 'pg-group-wrapper' + (g.collapsed ? ' pg-collapsed' : '');
                    if (totalPersonasInGroup === 0) wrapper.classList.add('pg-empty');
                    wrapper.dataset.gid = g.id;

                    const header = document.createElement('div');
                    header.className = 'pg-group-header';
                    const countText = totalPersonasInGroup === 0 ? '空' : visibleInGroup.length;
                    header.innerHTML =
                        '<i class="fa-solid fa-chevron-down pg-toggle"></i>' +
                        '<span class="pg-group-name">' + esc(g.name) + '</span>' +
                        '<span class="pg-group-count">' + countText + '</span>' +
                        '<div class="pg-group-actions">' +
                        '<i class="fa-solid fa-pen pg-btn-rename" title="重命名"></i>' +
                        '<i class="fa-solid fa-trash pg-btn-delgroup" title="删除分组"></i>' +
                        '</div>';
                    wrapper.appendChild(header);

                    const body = document.createElement('div');
                    body.className = 'pg-group-body';
                    body.dataset.gid = g.id;
                    // 折叠状态下也照样填充，折叠交给 CSS，这样折叠/展开只需切类，不重建 DOM
                    if (totalPersonasInGroup > 0) {
                        for (const a of visibleInGroup) {
                            const card = cardMap.get(a);
                            if (!card) continue;
                            shouldShow.add(a);
                            body.appendChild(card);
                        }
                    } else {
                        body.innerHTML = '<div class="pg-empty-hint">暂无人设，请用多选模式将人设移入此分组</div>';
                    }
                    wrapper.appendChild(body);
                    fragment.appendChild(wrapper);
                }
                if (fragment.childNodes.length) block.insertBefore(fragment, block.firstChild);
            }
        }

        for (const a of pageItemsForDisplay) {
            const card = cardMap.get(a);
            if (card) block.appendChild(card);
        }

        for (const [id, card] of cardMap) setShown(card, shouldShow.has(id));

        paintVisibleCards(cardMap.values());
        applySelectModeUI();
        bindWrappers(block);
        renderPager(totalPages);
    } finally {
        _lastSig = computeListSignature();
        requestAnimationFrame(() => {
            isReorganizing = false;
            if (scrollContainer && savedScrollTop > 0) scrollContainer.scrollTop = savedScrollTop;
        });
    }
}

async function ensureAllCardsInDom() {
    const block = document.getElementById('user_avatar_block');
    if (!block) return;

    const allAvatars = getAllAvatars();

    const presentInDom = new Set();
    block.querySelectorAll(':scope > .avatar-container').forEach(c => {
        const id = getCardAvatarId(c);
        if (id) presentInDom.add(id);
    });

    const missing = allAvatars.filter(a => !presentInDom.has(a));
    if (missing.length === 0) return;

    await loadPersonaApi();
    if (_getUserAvatars) {
        try { await _getUserAvatars(false); } catch (e) {}
    }

    const presentAfter = new Set();
    block.querySelectorAll(':scope > .avatar-container').forEach(c => {
        const id = getCardAvatarId(c);
        if (id) presentAfter.add(id);
    });
    const stillMissing = allAvatars.filter(a => !presentAfter.has(a));
    if (stillMissing.length === 0) return;

    const template = block.querySelector(':scope > .avatar-container');
    if (!template) return;

    const frag = document.createDocumentFragment();
    for (const avatar of stillMissing) {
        const clone = template.cloneNode(true);
        clone.classList.remove('selected');
        clone.dataset.pgClone = '1';

        clone.dataset.avatarId = avatar;
        clone.setAttribute('title', avatar);
        clone.querySelectorAll('[data-avatar-id]').forEach(el => {
            el.dataset.avatarId = avatar;
            el.setAttribute('title', avatar);
        });
        _aidCache.set(clone, avatar);

        // 关键：清掉从模板卡继承来的懒加载属性，否则会被还原成模板卡的头像
        clone.querySelectorAll('img').forEach(img => {
            delete img.dataset.pgPainted;
            delete img.dataset.pgFixAt;
            delete img.dataset.pgFixN;
            sanitizeLazyImg(img, getAvatarUrl(avatar));
            img.alt = getName(avatar);
        });

        clone.querySelectorAll('.ch_name, .character_name').forEach(el => {
            el.textContent = getName(avatar);
        });

        const desc = (power_user.persona_descriptions || {})[avatar] || {};
        clone.querySelectorAll('.ch_description').forEach(el => {
            el.textContent = desc.description || '';
        });

        const realTitle = (typeof desc.title === 'string') ? desc.title.trim() : '';
        const nameBlock = clone.querySelector('.character_name_block');
        let infoEl = clone.querySelector('.ch_additional_info');
        if (realTitle) {
            if (!infoEl && nameBlock) {
                infoEl = document.createElement('small');
                infoEl.className = 'ch_additional_info';
                nameBlock.appendChild(infoEl);
            }
            if (infoEl) infoEl.textContent = realTitle;
        } else if (infoEl) {
            infoEl.remove();
        }

        delete clone.dataset.pgClickHooked;

        clone.addEventListener('click', async () => {
            if (state.selectMode) return;
            const before = power_user.user_avatar;
            setTimeout(async () => {
                if (power_user.user_avatar === before) await switchPersona(avatar);
            }, 50);
        });

        frag.appendChild(clone);
    }
    block.appendChild(frag);
}

function applySelectModeUI() {
    const block = document.getElementById('user_avatar_block');
    if (!block) return;
    block.querySelectorAll('.pg-check').forEach(cb => cb.remove());
    block.querySelectorAll('.avatar-container').forEach(c => {
        c.classList.remove('pg-select-mode', 'pg-checked');
    });
    if (!state.selectMode) return;

    block.querySelectorAll('.avatar-container').forEach(c => {
        const id = getCardAvatarId(c);
        if (!id) return;
        c.classList.add('pg-select-mode');
        if (state.selected.has(id)) c.classList.add('pg-checked');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'pg-check';
        cb.checked = state.selected.has(id);
        cb.addEventListener('click', e => {
            e.stopPropagation();
            if (state.selected.has(id)) state.selected.delete(id);
            else state.selected.add(id);
            c.classList.toggle('pg-checked', state.selected.has(id));
            cb.checked = state.selected.has(id);
            updateSelectionCount();
        });

        if (!c.dataset.pgClickHooked) {
            c.dataset.pgClickHooked = '1';
            c.addEventListener('click', interceptInSelectMode, true);
        }
        c.appendChild(cb);
    });
}

function updateSelectionCount() {
    const t = document.getElementById(TOOLBAR_ID);
    if (!t) return;
    const span = t.querySelector('.pg-selection-bar > span b');
    if (span) span.textContent = state.selected.size;
}

function interceptInSelectMode(e) {
    if (!state.selectMode) return;
    if (e.target.classList.contains('pg-check')) return;
    e.stopPropagation();
    e.preventDefault();
    const card = e.currentTarget;
    const id = getCardAvatarId(card);
    if (!id) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    // 只更新这一张卡，不重建整个列表
    card.classList.toggle('pg-checked', state.selected.has(id));
    const cb = card.querySelector('.pg-check');
    if (cb) cb.checked = state.selected.has(id);
    updateSelectionCount();
}

function bindWrappers(block) {
    block.querySelectorAll(':scope > .pg-group-wrapper').forEach(div => {
        const gid = div.dataset.gid;
        const header = div.querySelector('.pg-group-header');
        if (header && !header.dataset.pgBound) {
            header.dataset.pgBound = '1';
            header.addEventListener('click', e => {
                if (e.target.closest('.pg-group-actions')) return;
                // 折叠只切类 + 存状态，不重排列表（消除闪烁）
                const wrapper = header.closest('.pg-group-wrapper');
                const next = !isCollapsed(gid);
                setCollapsed(gid, next);
                if (wrapper) wrapper.classList.toggle('pg-collapsed', next);
                // 展开时懒加载插件会重新处理这批图，稍后校验一次
                if (!next && wrapper) {
                    clearTimeout(window.__pg_expand_repair);
                    window.__pg_expand_repair = setTimeout(() => {
                        wrapper.querySelectorAll('.avatar-container img').forEach(repairOneImg);
                    }, 400);
                }
            });
        }
        const rn = div.querySelector('.pg-btn-rename');
        if (rn && !rn.dataset.pgBound) {
            rn.dataset.pgBound = '1';
            rn.addEventListener('click', e => {
                e.stopPropagation();
                const cur = (getGroups().find(x => x.id === gid) || {}).name || '';
                const n = prompt('重命名：', cur);
                if (n && n.trim()) {
                    renameGroup(gid, n.trim());
                    // 只改标题文字 + 工具栏下拉，不重排列表
                    const nameEl = div.querySelector('.pg-group-name');
                    if (nameEl) nameEl.textContent = n.trim();
                    renderToolbar();
                    _lastSig = computeListSignature();
                }
            });
        }
        const db = div.querySelector('.pg-btn-delgroup');
        if (db && !db.dataset.pgBound) {
            db.dataset.pgBound = '1';
            db.addEventListener('click', e => {
                e.stopPropagation();
                if (confirm('删除该分组？')) { deleteGroup(gid); refreshMain(); }
            });
        }
    });
}

// ========== 位置2：快捷弹窗 ==========
let _popperInstance = null;

function initQuick() {
    if (!isQuickEnabled()) return;
    if (isStQuickPersonaEnabled()) return;

    const tryInject = () => {
        const leftForm = document.getElementById('leftSendForm');
        if (!leftForm) { setTimeout(tryInject, 500); return; }
        if (document.getElementById(BTN_ID)) return;

        const $btn = window.jQuery(
            '<div id="' + BTN_ID + '" class="interactable" tabindex="0" title="人设分组（快捷切换）" role="button">' +
            '<img class="pg-quick-btn-img" alt="" loading="eager" data-pg-no-lazy="1">' +
            '<i class="fa-solid fa-user-circle pg-fallback-icon" style="display:none;"></i>' +
            '</div>'
        );
        window.jQuery(leftForm).append($btn);

        $btn.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleQuick();
        });

        setTimeout(updateQuickBtnAvatar, 100);
        setTimeout(updateQuickBtnAvatar, 1000);
        setTimeout(updateQuickBtnAvatar, 3000);
    };
    tryInject();

    if (!window.__pg_body_click_hooked) {
        window.__pg_body_click_hooked = true;
        window.jQuery(document.body).on('click.pgQuick', (e) => {
            const p = document.getElementById(POPUP_ID);
            if (!p || p.style.display === 'none') return;
            if (e.target.closest('#' + POPUP_ID)) return;
            if (e.target.closest('#' + BTN_ID)) return;
            closeQuick();
        });
    }
}

function updateQuickBtnAvatar() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const img = btn.querySelector('.pg-quick-btn-img');
    const fallback = btn.querySelector('.pg-fallback-icon');
    if (!img) return;
    let cur = power_user.user_avatar || power_user.default_persona;
    if (!cur) {
        const sel = document.querySelector('#user_avatar_block .avatar-container.selected [data-avatar-id]')
            || document.querySelector('#user_avatar_block [data-avatar-id].selected');
        if (sel) cur = sel.dataset.avatarId;
    }
    if (!cur) {
        const first = document.querySelector('#user_avatar_block [data-avatar-id]');
        if (first) cur = first.dataset.avatarId;
    }
    if (cur) {
        if (img.getAttribute('data-current') !== cur) {
            sanitizeLazyImg(img, getAvatarUrl(cur));
            img.alt = getName(cur);
            img.setAttribute('data-current', cur);
        }
        img.style.display = '';
        if (fallback) fallback.style.display = 'none';
    } else {
        img.style.display = 'none';
        if (fallback) fallback.style.display = '';
    }
}

function refreshQuick() {
    updateQuickBtnAvatar();
    const p = document.getElementById(POPUP_ID);
    if (p && p.style.display !== 'none') renderQuick();
}

async function toggleQuick() {
    let p = document.getElementById(POPUP_ID);
    if (p && p.style.display !== 'none') {
        closeQuick();
        return;
    }
    if (!p) {
        p = document.createElement('div');
        p.id = POPUP_ID;
        p.className = 'pg-quick-popup';
        document.body.appendChild(p);
    }
    p.style.display = 'block';
    renderQuick();
    await positionQuick(p);
}

function closeQuick() {
    const p = document.getElementById(POPUP_ID);
    if (!p) return;
    p.style.display = 'none';
    if (_popperInstance) {
        try { _popperInstance.destroy(); } catch (e) {}
        _popperInstance = null;
    }
}

async function positionQuick(p) {
    const b = document.getElementById(BTN_ID);
    if (!b) return;

    const Popper = await loadPopper();

    if (Popper && typeof Popper.createPopper === 'function') {
        try {
            if (_popperInstance) {
                try { _popperInstance.destroy(); } catch (e) {}
                _popperInstance = null;
            }
            p.style.position = '';
            p.style.left = '';
            p.style.top = '';
            p.style.bottom = '';

            _popperInstance = Popper.createPopper(b, p, {
                placement: 'top-start',
                modifiers: [
                    { name: 'offset', options: { offset: [0, 8] } },
                    { name: 'preventOverflow', options: { padding: 8 } },
                    { name: 'flip', options: { fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'] } },
                ],
            });
            return;
        } catch (e) {
            console.warn('[' + EXT_NAME + '] Popper failed, fallback to manual:', e);
        }
    }

    const r = b.getBoundingClientRect();
    p.style.position = 'fixed';
    const pw = p.offsetWidth || 320;
    const ph = p.offsetHeight || 400;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    let bottom = vh - r.top + 8;
    let left = r.left - 100;
    if (left < margin) left = margin;
    if (left + pw + margin > vw) left = Math.max(margin, vw - pw - margin);
    if (bottom + ph > vh - margin && r.bottom + 8 + ph < vh - margin) {
        p.style.bottom = '';
        p.style.top = (r.bottom + 8) + 'px';
    } else {
        p.style.top = '';
        p.style.bottom = bottom + 'px';
    }
    p.style.left = left + 'px';
}

function isCurrent(a) {
    if (power_user.user_avatar === a) return true;
    if (power_user.default_persona === a) return true;
    return false;
}

function renderQuick() {
    const p = document.getElementById(POPUP_ID);
    if (!p) return;
    const all = getAllAvatars();
    const grouped = new Set();
    let h = '<div class="pg-quick-header">切换人设</div>';
    for (const g of getGroups()) {
        const ps = g.personas.filter(a => all.includes(a));
        ps.forEach(a => grouped.add(a));
        if (ps.length === 0) continue;
        h += '<div class="pg-quick-group' + (g.collapsed ? ' pg-collapsed' : '') + '" data-gid="' + g.id + '">';
        h += '<div class="pg-quick-group-header"><i class="fa-solid fa-chevron-down"></i><span>' + esc(g.name) + '</span><span class="pg-quick-count">' + ps.length + '</span></div>';
        h += '<div class="pg-quick-grid">';
        for (const a of ps) h += renderQuickAv(a);
        h += '</div></div>';
    }
    const ung = all.filter(a => !grouped.has(a));
    if (ung.length > 0) {
        h += '<div class="pg-quick-ungrouped"><div class="pg-quick-grid">';
        for (const a of ung) h += renderQuickAv(a);
        h += '</div></div>';
    }
    p.innerHTML = h;

    window.jQuery(p).find('.pg-quick-avatar').on('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const a = this.dataset.avatar;
        document.querySelectorAll('.pg-quick-avatar.pg-current').forEach(x => x.classList.remove('pg-current'));
        this.classList.add('pg-current');
        await switchPersona(a);
        setTimeout(updateQuickBtnAvatar, 50);
        closeQuick();
    });
    // 弹窗内折叠也只切类，不重建 innerHTML（避免头像重新创建导致闪烁）
    window.jQuery(p).find('.pg-quick-group-header').on('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const groupEl = this.parentElement;
        const gid = groupEl.dataset.gid;
        const next = !isCollapsed(gid);
        setCollapsed(gid, next);
        groupEl.classList.toggle('pg-collapsed', next);
        const popup = document.getElementById(POPUP_ID);
        if (popup) await positionQuick(popup);
    });
}

// hover 提示：名字 + 备注(title)
function renderQuickAv(a) {
    const name = getName(a);
    const titleNote = getPersonaTitle(a);
    const tooltip = titleNote ? (name + '\n' + titleNote) : name;
    const url = getAvatarUrl(a);
    return '<div class="pg-quick-avatar' + (isCurrent(a) ? ' pg-current' : '') + '" data-avatar="' + esc(a) + '" title="' + esc(tooltip) + '">'
        + '<img src="' + url + '" loading="eager" data-pg-no-lazy="1"'
        + ' style="background-image:url(&quot;' + url + '&quot;);background-size:cover;background-position:center;">'
        + '</div>';
}

// ========== 入口 ==========
jQuery(async () => {
    console.log('[' + EXT_NAME + '] Loading...');
    initStorage();
    await loadPersonaApi();
    loadPopper();
    await refreshValidAvatars(true);

    try { initExtensionSettings(); } catch (err) { console.error('[' + EXT_NAME + '] Settings panel init failed:', err); }
    try { initMainPanel(); } catch (err) { console.error('[' + EXT_NAME + '] Main panel init failed:', err); }

    if (isQuickEnabled() && !isStQuickPersonaEnabled()) {
        try { initQuick(); } catch (err) { console.error('[' + EXT_NAME + '] Quick panel init failed:', err); }
    } else if (isStQuickPersonaEnabled()) {
        console.log('[' + EXT_NAME + '] Quick popup skipped (ST Quick Persona is enabled).');
    }

    // 事件刷新：合并节流 + 面板不可见时挂起 + 内容没变就跳过
    let _refreshTimer = null;
    const refreshAll = () => {
        clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(async () => {
            await refreshValidAvatars();
            try { refreshQuick(); } catch (e) {}
            if (!isPanelVisible()) { markPendingRefresh(); return; }
            // 绑定筛选依赖锁定状态，切人设可能改变它，这种情况必须重排
            const mustRefresh = (state.filter === 'bound' || state.filter === 'unbound');
            const sig = computeListSignature();
            if (!mustRefresh && sig === _lastSig) return;
            _lastSig = sig;
            try { refreshMain(); } catch (e) {}
        }, 250);
    };
    if (eventSource && event_types) {
        if (event_types.SETTINGS_UPDATED) eventSource.on(event_types.SETTINGS_UPDATED, refreshAll);
        if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, refreshAll);
    }

    const obs = document.getElementById('user_avatar_block');
    if (obs) {
        let lastCardCount = obs.querySelectorAll('.avatar-container').length;

        // 只有卡片总数真的变化才重排；容器间搬动 / class 变化一律忽略（消除闪烁）
        new MutationObserver(() => {
            if (isReorganizing) return;
            const now = obs.querySelectorAll('.avatar-container').length;
            if (now === lastCardCount) return;
            lastCardCount = now;
            clearTimeout(window.__pg_reorg_timer);
            window.__pg_reorg_timer = setTimeout(() => {
                Promise.resolve(reorganizeNative()).then(() => {
                    lastCardCount = obs.querySelectorAll('.avatar-container').length;
                });
            }, 150);
        }).observe(obs, { childList: true, subtree: true });

        // 懒加载兼容：只修被改坏的单张图，带次数上限
        new MutationObserver(muts => {
            if (isReorganizing) return;
            for (const m of muts) {
                const t = m.target;
                if (t && t.tagName === 'IMG') repairOneImg(t);
            }
        }).observe(obs, { attributes: true, attributeFilter: ['src'], subtree: true });
    }

    window.addEventListener('resize', () => {
        const p = document.getElementById(POPUP_ID);
        if (p && p.style.display !== 'none') {
            if (_popperInstance) {
                try { _popperInstance.update(); } catch (e) {}
            } else {
                positionQuick(p);
            }
        }
    });

    console.log('[' + EXT_NAME + '] Loaded successfully.');
});
