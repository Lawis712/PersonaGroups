import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';

const EXT_NAME = 'Persona Groups';
const KEY = 'persona_groups';
const CONTAINER_ID = 'pg-main-container';
const BTN_ID = 'pg-quick-btn';
const POPUP_ID = 'pg-quick-popup';

// ========== 存储 ==========
function initStorage() {
    if (!extension_settings[KEY]) {
        extension_settings[KEY] = { groups: [], version: 1 };
        saveSettingsDebounced();
    }
    if (!extension_settings[KEY].groups) {
        extension_settings[KEY].groups = [];
        saveSettingsDebounced();
    }
}
function getGroups() { return extension_settings[KEY].groups; }
function saveGroups() { saveSettingsDebounced(); }
function createGroup(name) {
    const id = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    getGroups().push({ id, name: name || '新分组', collapsed: false, personas: [] });
    saveGroups();
}
function renameGroup(id, n) { const g = getGroups().find(x=>x.id===id); if(g){g.name=n;saveGroups();} }
function deleteGroup(id) { const gs = getGroups(); const i = gs.findIndex(x=>x.id===id); if(i>=0){gs.splice(i,1);saveGroups();} }
function toggleCollapse(id) { const g = getGroups().find(x=>x.id===id); if(g){g.collapsed=!g.collapsed;saveGroups();} }
function movePersonas(avatars, targetId) {
    for (const g of getGroups()) g.personas = g.personas.filter(a=>!avatars.includes(a));
    if (targetId) {
        const t = getGroups().find(x=>x.id===targetId);
        if (t) for (const a of avatars) if (!t.personas.includes(a)) t.personas.push(a);
    }
    saveGroups();
}
function getUngrouped(all) {
    const grouped = new Set();
    for (const g of getGroups()) g.personas.forEach(a=>grouped.add(a));
    return all.filter(a=>!grouped.has(a));
}

// ========== 工具 ==========
function getAllAvatars() { return Object.keys(power_user.personas || {}); }
function getName(a) { return (power_user.personas || {})[a] || a; }
function getAvatarUrl(a) { return '/thumbnail?type=persona&file=' + encodeURIComponent(a); }
function isBound(a) {
    const desc = (power_user.persona_descriptions || {})[a];
    if (desc && desc.position === 'character') return true;
    const locked = power_user.personas_lock || power_user.lockedPersonas || {};
    if (typeof locked === 'object') for (const k in locked) if (locked[k] === a) return true;
    return false;
}

// 通过 data-avatar-id 找原生节点
function findNativeNode(avatar) {
    return document.querySelector('#user_avatar_block [data-avatar-id="' + CSS.escape(avatar) + '"]');
}

function isCurrent(a) {
    if (power_user.user_avatar === a) return true;
    if (power_user.default_persona === a) return true;
    const native = findNativeNode(a);
    if (native && native.classList.contains('selected')) return true;
    // 也检查父节点（avatar-container 可能带 selected）
    if (native && native.parentElement && native.parentElement.classList.contains('selected')) return true;
    return false;
}

function switchPersona(avatar) {
    const native = findNativeNode(avatar);
    if (native) {
        native.click();
        return;
    }
    console.warn('[' + EXT_NAME + '] Cannot find native node for:', avatar);
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ========== 状态 ==========
const state = { selectMode: false, selected: new Set(), filter: 'all' };

// ========== 主面板 ==========
function initMainPanel() {
    const tryInject = () => {
        const native = document.getElementById('user_avatar_block');
        if (!native) { setTimeout(tryInject, 500); return; }
        if (document.getElementById(CONTAINER_ID)) return;
        const c = document.createElement('div');
        c.id = CONTAINER_ID;
        c.className = 'pg-main';
        native.parentElement.insertBefore(c, native);
        native.classList.add('pg-native-hidden');
        renderMain();
    };
    tryInject();
}

function refreshMain() {
    if (document.getElementById(CONTAINER_ID)) renderMain();
}

function applyFilter(avatars) {
    let r = avatars;
    if (state.filter === 'bound') r = r.filter(a => isBound(a));
    else if (state.filter === 'unbound') r = r.filter(a => !isBound(a));
    return r;
}

function renderMain() {
    const c = document.getElementById(CONTAINER_ID);
    if (!c) return;
    const all = getAllAvatars();
    const filtered = applyFilter(all);

    let html = '<div class="pg-toolbar">';
    html += '<select class="pg-filter">';
    html += '<option value="all"' + (state.filter==='all'?' selected':'') + '>全部</option>';
    html += '<option value="bound"' + (state.filter==='bound'?' selected':'') + '>已绑定</option>';
    html += '<option value="unbound"' + (state.filter==='unbound'?' selected':'') + '>未绑定</option>';
    html += '</select>';
    html += '<button class="menu_button pg-btn-newgroup" title="新建分组"><i class="fa-solid fa-folder-plus"></i></button>';
    html += '<button class="menu_button pg-btn-selectmode' + (state.selectMode?' pg-active':'') + '" title="多选模式"><i class="fa-solid fa-check-double"></i></button>';
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

    html += '<div class="pg-groups-list"></div>';
    html += '<div class="pg-ungrouped-section"><div class="pg-personas pg-ungrouped-personas"></div></div>';
    c.innerHTML = html;

    const groupsList = c.querySelector('.pg-groups-list');
    for (const g of getGroups()) groupsList.appendChild(renderGroup(g, filtered));

    const ung = getUngrouped(filtered);
    const ungDiv = c.querySelector('.pg-ungrouped-personas');
    for (const a of ung) ungDiv.appendChild(renderCard(a));

    bindMain(c);
}

function renderGroup(g, filtered) {
    const div = document.createElement('div');
    div.className = 'pg-group' + (g.collapsed ? ' pg-collapsed' : '');
    div.dataset.gid = g.id;
    const inG = g.personas.filter(a => filtered.includes(a));
    let h = '<div class="pg-group-header">';
    h += '<i class="fa-solid fa-chevron-down pg-toggle"></i>';
    h += '<span class="pg-group-name">' + esc(g.name) + '</span>';
    h += '<span class="pg-group-count">' + inG.length + '</span>';
    h += '<div class="pg-group-actions">';
    h += '<i class="fa-solid fa-pen pg-btn-rename" title="重命名"></i>';
    h += '<i class="fa-solid fa-trash pg-btn-delgroup" title="删除分组"></i>';
    h += '</div></div>';
    h += '<div class="pg-group-body"><div class="pg-personas"></div></div>';
    div.innerHTML = h;
    const body = div.querySelector('.pg-personas');
    for (const a of inG) body.appendChild(renderCard(a));
    return div;
}

function renderCard(avatar) {
    const card = document.createElement('div');
    card.className = 'pg-persona-card' + (isCurrent(avatar) ? ' pg-current' : '');
    card.dataset.avatar = avatar;
    let h = '';
    if (state.selectMode) h += '<input type="checkbox" class="pg-check"' + (state.selected.has(avatar)?' checked':'') + '>';
    h += '<img src="' + getAvatarUrl(avatar) + '" class="pg-avatar-img">';
    h += '<div class="pg-persona-name">' + esc(getName(avatar)) + '</div>';
    if (isBound(avatar)) h += '<i class="fa-solid fa-link pg-bound-icon" title="已绑定角色"></i>';
    card.innerHTML = h;
    card.addEventListener('click', e => {
        if (state.selectMode) {
            e.preventDefault(); e.stopPropagation();
            if (state.selected.has(avatar)) state.selected.delete(avatar);
            else state.selected.add(avatar);
            renderMain();
            return;
        }
        switchPersona(avatar);
    });
    return card;
}

function bindMain(c) {
    const filter = c.querySelector('.pg-filter');
    if (filter) filter.addEventListener('change', e => { state.filter = e.target.value; renderMain(); });
    const ng = c.querySelector('.pg-btn-newgroup');
    if (ng) ng.addEventListener('click', () => {
        const n = prompt('新分组名称：', '新分组');
        if (n && n.trim()) { createGroup(n.trim()); renderMain(); }
    });
    const sm = c.querySelector('.pg-btn-selectmode');
    if (sm) sm.addEventListener('click', () => { state.selectMode = !state.selectMode; state.selected.clear(); renderMain(); });

    if (state.selectMode) {
        const cb = c.querySelector('.pg-btn-clear-sel');
        if (cb) cb.addEventListener('click', () => { state.selected.clear(); renderMain(); });
        const mb = c.querySelector('.pg-btn-move');
        if (mb) mb.addEventListener('click', () => {
            const t = c.querySelector('.pg-move-target').value;
            if (!t) return;
            const arr = [...state.selected];
            movePersonas(arr, t === '__ungroup__' ? null : t);
            state.selected.clear();
            renderMain();
        });
        c.querySelectorAll('.pg-check').forEach(cb => cb.addEventListener('click', e => {
            e.stopPropagation();
            const card = e.target.closest('.pg-persona-card');
            if (card) {
                if (state.selected.has(card.dataset.avatar)) state.selected.delete(card.dataset.avatar);
                else state.selected.add(card.dataset.avatar);
                renderMain();
            }
        }));
    }

    c.querySelectorAll('.pg-group').forEach(div => {
        const gid = div.dataset.gid;
        const t = div.querySelector('.pg-toggle');
        if (t) t.addEventListener('click', () => { toggleCollapse(gid); renderMain(); });
        const rn = div.querySelector('.pg-btn-rename');
        if (rn) rn.addEventListener('click', () => {
            const cur = (getGroups().find(x => x.id === gid) || {}).name || '';
            const n = prompt('重命名：', cur);
            if (n && n.trim()) { renameGroup(gid, n.trim()); renderMain(); }
        });
        const db = div.querySelector('.pg-btn-delgroup');
        if (db) db.addEventListener('click', () => {
            if (confirm('删除该分组？')) { deleteGroup(gid); renderMain(); }
        });
    });
}

// ========== 快捷弹窗 ==========
function initQuick() {
    const tryInject = () => {
        const wand = document.getElementById('extensionsMenuButton');
        if (!wand) { setTimeout(tryInject, 500); return; }
        if (document.getElementById(BTN_ID)) return;
        const btn = document.createElement('div');
        btn.id = BTN_ID;
        btn.className = 'fa-solid fa-user-group interactable';
        btn.title = '人设分组（快捷切换）';
        btn.tabIndex = 0;
        wand.parentElement.insertBefore(btn, wand.nextSibling);
        btn.addEventListener('click', toggleQuick);
    };
    tryInject();
}

function refreshQuick() {
    const p = document.getElementById(POPUP_ID);
    if (p && p.style.display !== 'none') renderQuick();
}

function toggleQuick() {
    let p = document.getElementById(POPUP_ID);
    if (p) {
        if (p.style.display === 'none') {
            p.style.display = 'block';
            renderQuick();
            positionQuick(p);
            attachOutsideClose();
        } else {
            p.style.display = 'none';
        }
        return;
    }
    p = document.createElement('div');
    p.id = POPUP_ID;
    p.className = 'pg-quick-popup';
    document.body.appendChild(p);
    renderQuick();
    positionQuick(p);
    attachOutsideClose();
}

function attachOutsideClose() {
    setTimeout(() => {
        document.addEventListener('mousedown', closeQuick, true);
    }, 0);
}

function closeQuick(e) {
    const p = document.getElementById(POPUP_ID);
    const b = document.getElementById(BTN_ID);
    if (!p || p.style.display === 'none') {
        document.removeEventListener('mousedown', closeQuick, true);
        return;
    }
    if (b && (e.target === b || b.contains(e.target))) return;
    if (p.contains(e.target)) return;
    p.style.display = 'none';
    document.removeEventListener('mousedown', closeQuick, true);
}

function positionQuick(p) {
    const b = document.getElementById(BTN_ID);
    if (!b) return;
    const r = b.getBoundingClientRect();
    p.style.position = 'fixed';
    p.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    p.style.left = Math.max(8, r.left - 100) + 'px';
}

function renderQuick() {
    const p = document.getElementById(POPUP_ID);
    if (!p) return;
    const all = getAllAvatars();
    let h = '<div class="pg-quick-header">切换人设</div>';
    for (const g of getGroups()) {
        const ps = g.personas.filter(a => all.includes(a));
        if (ps.length === 0) continue;
        h += '<div class="pg-quick-group' + (g.collapsed?' pg-collapsed':'') + '" data-gid="' + g.id + '">';
        h += '<div class="pg-quick-group-header"><i class="fa-solid fa-chevron-down"></i><span>' + esc(g.name) + '</span><span class="pg-quick-count">' + ps.length + '</span></div>';
        h += '<div class="pg-quick-grid">';
        for (const a of ps) h += renderQuickAv(a);
        h += '</div></div>';
    }
    const ung = getUngrouped(all);
    if (ung.length > 0) {
        h += '<div class="pg-quick-ungrouped"><div class="pg-quick-grid">';
        for (const a of ung) h += renderQuickAv(a);
        h += '</div></div>';
    }
    p.innerHTML = h;
    p.querySelectorAll('.pg-quick-avatar').forEach(el => el.addEventListener('click', () => {
        const a = el.dataset.avatar;
        switchPersona(a);
        p.style.display = 'none';
    }));
    p.querySelectorAll('.pg-quick-group-header').forEach(hh => hh.addEventListener('click', () => {
        toggleCollapse(hh.parentElement.dataset.gid);
        renderQuick();
    }));
}

function renderQuickAv(a) {
    return '<div class="pg-quick-avatar' + (isCurrent(a)?' pg-current':'') + '" data-avatar="' + esc(a) + '" title="' + esc(getName(a)) + '"><img src="' + getAvatarUrl(a) + '"></div>';
}

// ========== 入口 ==========
jQuery(async () => {
    console.log('[' + EXT_NAME + '] Loading...');
    initStorage();
    try { initMainPanel(); console.log('[' + EXT_NAME + '] Main panel initialized.'); }
    catch (err) { console.error('[' + EXT_NAME + '] Main panel init failed:', err); }

    const qp = extension_settings.quickPersona;
    if (qp && qp.enabled === true) {
        if (typeof toastr !== 'undefined') toastr.warning('Quick Persona enabled, quick popup disabled.', EXT_NAME);
    } else {
        try { initQuick(); console.log('[' + EXT_NAME + '] Quick panel initialized.'); }
        catch (err) { console.error('[' + EXT_NAME + '] Quick panel init failed:', err); }
    }

    const refreshAll = () => { try { refreshMain(); } catch(e){} try { refreshQuick(); } catch(e){} };
    if (eventSource && event_types) {
        if (event_types.SETTINGS_UPDATED) eventSource.on(event_types.SETTINGS_UPDATED, refreshAll);
        if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, refreshAll);
    }
    const obs = document.getElementById('user_avatar_block');
    if (obs) new MutationObserver(refreshAll).observe(obs, { childList: true });

    console.log('[' + EXT_NAME + '] Loaded successfully.');
});
