import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';

const EXT_NAME = 'Persona Groups';
const KEY = 'persona_groups';
const TOOLBAR_ID = 'pg-toolbar-container';
const PAGER_ID = 'pg-pager';
const BTN_ID = 'pg-quick-btn';
const POPUP_ID = 'pg-quick-popup';

// ========== 存储 ==========
function initStorage() {
    if (!extension_settings[KEY]) {
        extension_settings[KEY] = { groups: [], pageSize: 20, version: 2, groupsHidden: false };
        saveSettingsDebounced();
    }
    if (!extension_settings[KEY].groups) extension_settings[KEY].groups = [];
    if (!extension_settings[KEY].pageSize) extension_settings[KEY].pageSize = 20;
    if (typeof extension_settings[KEY].groupsHidden !== 'boolean') extension_settings[KEY].groupsHidden = false;
    saveSettingsDebounced();
}
function getGroups() { return extension_settings[KEY].groups; }
function getPageSize() { return extension_settings[KEY].pageSize || 20; }
function setPageSize(n) { extension_settings[KEY].pageSize = n; saveSettingsDebounced(); }
function isGroupsHidden() { return !!extension_settings[KEY].groupsHidden; }
function setGroupsHidden(v) { extension_settings[KEY].groupsHidden = !!v; saveSettingsDebounced(); }
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

// ========== 工具 ==========
let _validAvatars = null;
let _validAvatarsSet = null;

async function refreshValidAvatars() {
    await loadPersonaApi();
    if (_getUserAvatars) {
        try {
            const list = await _getUserAvatars(false);
            if (Array.isArray(list)) {
                _validAvatars = list;
                _validAvatarsSet = new Set(list);
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
function isBound(a) {
    const desc = (power_user.persona_descriptions || {})[a];
    if (desc) {
        if (desc.position === 'character') return true;
        if (Array.isArray(desc.connections) && desc.connections.length > 0) return true;
        if (desc.lockedFor && Array.isArray(desc.lockedFor) && desc.lockedFor.length > 0) return true;
    }
    const lockObjs = [power_user.personas_lock, power_user.lockedPersonas, power_user.persona_lock];
    for (const lock of lockObjs) {
        if (!lock || typeof lock !== 'object') continue;
        if (lock[a] !== undefined && lock[a] !== null && lock[a] !== '') return true;
        for (const k in lock) if (lock[k] === a) return true;
    }
    if (Array.isArray(power_user.persona_locked_chats) && power_user.persona_locked_chats.includes(a)) return true;
    return false;
}
function getCardAvatarId(card) {
    const inner = card.querySelector('.avatar[data-avatar-id]') || card.querySelector('[data-avatar-id]');
    if (inner && inner.dataset.avatarId) return inner.dataset.avatarId;
    if (card.dataset && card.dataset.avatarId) return card.dataset.avatarId;
    return null;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ⭐ 判断当前筛选是不是某个分组 ID
function getFilterGroupId() {
    if (!state.filter || !state.filter.startsWith('group:')) return null;
    return state.filter.slice('group:'.length);
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
        syncNativeSearch();
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

function syncNativeSearch() {
    const searchInput = document.getElementById('persona_search_bar');
    if (!searchInput) return;
    if (searchInput.dataset.pgSearchHooked) return;
    searchInput.dataset.pgSearchHooked = '1';
    searchInput.addEventListener('input', () => {
        state.search = searchInput.value || '';
        state.page = 0;
        reorganizeNative();
    });
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

    // ⭐ 如果当前 filter 指向已删除的分组，自动回退到 all
    const currentGroupId = getFilterGroupId();
    if (currentGroupId && !getGroups().find(g => g.id === currentGroupId)) {
        state.filter = 'all';
    }

    let html = '<div class="pg-toolbar">';
    html += '<select class="pg-filter">';
    html += '<option value="all"' + (state.filter==='all'?' selected':'') + '>全部</option>';
    html += '<option value="bound"' + (state.filter==='bound'?' selected':'') + '>已绑定</option>';
    html += '<option value="unbound"' + (state.filter==='unbound'?' selected':'') + '>未绑定</option>';

    // ⭐ optgroup 列出所有分组
    const groups = getGroups();
    if (groups.length > 0) {
        html += '<optgroup label="────୨ৎ──── 按分组 ────୨ৎ────">';
        for (const g of groups) {
            const v = 'group:' + g.id;
            html += '<option value="' + esc(v) + '"' + (state.filter===v?' selected':'') + '>' + esc(g.name) + '</option>';
        }
        html += '</optgroup>';
    }

    html += '</select>';
    html += '<button class="menu_button pg-btn-newgroup" title="新建分组"><i class="fa-solid fa-folder-plus"></i></button>';
    html += '<button class="menu_button pg-btn-selectmode' + (state.selectMode?' pg-active':'') + '" title="多选模式"><i class="fa-solid fa-check-double"></i></button>';
    html += '<button class="menu_button pg-btn-toggle-groups' + (hidden?' pg-active':'') + '" title="' + (hidden?'显示分组':'隐藏分组') + '"><i class="fa-solid ' + (hidden?'fa-eye-slash':'fa-eye') + '"></i></button>';
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
    if (sm) sm.addEventListener('click', () => { state.selectMode = !state.selectMode; state.selected.clear(); refreshMain(); });
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

async function reorganizeNative() {
    const block = document.getElementById('user_avatar_block');
    if (!block) return;

    const scrollContainer = document.getElementById('PersonaManagement');
    const savedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    if (!_validAvatars) {
        await refreshValidAvatars();
    }

    if (state.search.trim()) {
        isReorganizing = true;
        try {
            block.querySelectorAll(':scope > .pg-group-wrapper').forEach(w => {
                const body = w.querySelector('.pg-group-body');
                if (body) {
                    Array.from(body.children).forEach(child => {
                        if (child.classList.contains('avatar-container')) {
                            block.appendChild(child);
                        }
                    });
                }
                w.remove();
            });
            block.querySelectorAll(':scope > .pg-empty-hint').forEach(el => el.remove());
            block.querySelectorAll(':scope > .avatar-container').forEach(c => {
                c.style.display = '';
            });
            applySelectModeUI();
            const pager = document.getElementById(PAGER_ID);
            if (pager) pager.style.display = 'none';
        } finally {
            requestAnimationFrame(() => {
                isReorganizing = false;
                if (scrollContainer && savedScrollTop > 0) {
                    scrollContainer.scrollTop = savedScrollTop;
                }
            });
        }
        return;
    }

    const pager = document.getElementById(PAGER_ID);
    if (pager) pager.style.display = '';

    isReorganizing = true;
    try {
        block.querySelectorAll(':scope > .pg-group-wrapper').forEach(w => {
            const body = w.querySelector('.pg-group-body');
            if (body) {
                Array.from(body.children).forEach(child => {
                    if (child.classList.contains('avatar-container')) {
                        block.appendChild(child);
                    }
                });
            }
            w.remove();
        });
        block.querySelectorAll(':scope > .pg-empty-hint').forEach(el => el.remove());

        await ensureAllCardsInDom();

        const allCards = Array.from(block.querySelectorAll(':scope > .avatar-container'));
        const cardMap = new Map();
        for (const c of allCards) {
            const id = getCardAvatarId(c);
            if (id && isValidAvatar(id) && !cardMap.has(id)) cardMap.set(id, c);
        }
        allCards.forEach(c => c.style.display = 'none');

        const filterGroupId = getFilterGroupId();

        // ⭐ 状态判断
        const isFilteringByGroup = !!filterGroupId;
        const hidden = isGroupsHidden();

        const passFilter = (avatar) => {
            // 分组筛选时，passFilter 不再判断 bound/unbound（因为下拉是单选，filter 已经是分组ID了）
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

        // ========== 三种渲染模式 ==========
        // 模式 A: 按分组筛选 → 只显示该分组内卡片，不画分组容器，分页对该卡片生效
        // 模式 B: 隐藏分组 → 只显示未分组卡片，不画分组容器，分页对未分组生效
        // 模式 C: 默认 → 画所有分组容器（不分页），分页对未分组生效

        let pageItemsForDisplay = [];   // 当前页要显示的 avatar 列表（按 block 顺序 append）
        let totalPages = 1;

        if (isFilteringByGroup) {
            // 模式 A
            const targetGroup = groups.find(g => g.id === filterGroupId);
            const groupAvatars = targetGroup
                ? targetGroup.personas.filter(a => cardMap.has(a))
                : [];
            const pageSize = getPageSize();
            totalPages = Math.max(1, Math.ceil(groupAvatars.length / pageSize));
            if (state.page >= totalPages) state.page = totalPages - 1;
            if (state.page < 0) state.page = 0;
            const start = state.page * pageSize;
            pageItemsForDisplay = groupAvatars.slice(start, start + pageSize);
        } else {
            // 模式 B / C：分页只对未分组（已筛选）生效
            const ungroupedFiltered = ungroupedAvatars.filter(passFilter);
            const pageSize = getPageSize();
            totalPages = Math.max(1, Math.ceil(ungroupedFiltered.length / pageSize));
            if (state.page >= totalPages) state.page = totalPages - 1;
            if (state.page < 0) state.page = 0;
            const start = state.page * pageSize;
            pageItemsForDisplay = ungroupedFiltered.slice(start, start + pageSize);

            // 模式 C：构建分组容器（不分页，全量显示）
            if (!hidden) {
                const fragmentsToPrepend = [];
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
                    if (!g.collapsed && totalPersonasInGroup > 0) {
                        for (const a of g.personas) {
                            if (cardMap.has(a) && passFilter(a)) {
                                const card = cardMap.get(a);
                                if (card) {
                                    card.style.display = '';
                                    body.appendChild(card);
                                }
                            }
                        }
                    } else if (!g.collapsed && totalPersonasInGroup === 0) {
                        body.innerHTML = '<div class="pg-empty-hint">暂无人设，请用多选模式将人设移入此分组</div>';
                    }
                    wrapper.appendChild(body);
                    fragmentsToPrepend.push(wrapper);
                }
                for (let i = fragmentsToPrepend.length - 1; i >= 0; i--) {
                    block.insertBefore(fragmentsToPrepend[i], block.firstChild);
                }
            }
        }

        // 显示当前页的卡片（按 pageItemsForDisplay 顺序 append 到 block 末尾）
        for (const a of pageItemsForDisplay) {
            const card = cardMap.get(a);
            if (!card) continue;
            card.style.display = '';
            block.appendChild(card);
        }

        applySelectModeUI();
        bindWrappers(block);
        renderPager(totalPages);
    } finally {
        requestAnimationFrame(() => {
            isReorganizing = false;
            if (scrollContainer && savedScrollTop > 0) {
                scrollContainer.scrollTop = savedScrollTop;
            }
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
        try { await _getUserAvatars(false); } catch(e) {}
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

    for (const avatar of stillMissing) {
        const clone = template.cloneNode(true);
        clone.classList.remove('selected');

        clone.dataset.avatarId = avatar;
        clone.setAttribute('title', avatar);
        clone.querySelectorAll('[data-avatar-id]').forEach(el => {
            el.dataset.avatarId = avatar;
            el.setAttribute('title', avatar);
        });

        clone.querySelectorAll('img').forEach(img => {
            img.src = getAvatarUrl(avatar);
            img.alt = getName(avatar);
            img.removeAttribute('srcset');
        });

        clone.querySelectorAll('.ch_name, .character_name').forEach(el => {
            el.textContent = getName(avatar);
        });

        delete clone.dataset.pgClickHooked;

        clone.addEventListener('click', async (e) => {
            if (state.selectMode) return;
            const before = power_user.user_avatar;
            setTimeout(async () => {
                if (power_user.user_avatar === before) {
                    await switchPersona(avatar);
                }
            }, 50);
        });

        block.appendChild(clone);
    }
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
            applySelectModeUI();
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
    const id = getCardAvatarId(e.currentTarget);
    if (!id) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    applySelectModeUI();
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
                toggleCollapse(gid);
                refreshMain();
            });
        }
        const rn = div.querySelector('.pg-btn-rename');
        if (rn && !rn.dataset.pgBound) {
            rn.dataset.pgBound = '1';
            rn.addEventListener('click', e => {
                e.stopPropagation();
                const cur = (getGroups().find(x => x.id === gid) || {}).name || '';
                const n = prompt('重命名：', cur);
                if (n && n.trim()) { renameGroup(gid, n.trim()); refreshMain(); }
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
    const tryInject = () => {
        const leftForm = document.getElementById('leftSendForm');
        if (!leftForm) { setTimeout(tryInject, 500); return; }
        if (document.getElementById(BTN_ID)) return;

        const $btn = window.jQuery(
            '<div id="' + BTN_ID + '" class="interactable" tabindex="0" title="人设分组（快捷切换）" role="button">' +
            '<img class="pg-quick-btn-img" alt="">' +
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

    window.jQuery(document.body).on('click.pgQuick', (e) => {
        const p = document.getElementById(POPUP_ID);
        if (!p || p.style.display === 'none') return;
        if (e.target.closest('#' + POPUP_ID)) return;
        if (e.target.closest('#' + BTN_ID)) return;
        closeQuick();
    });
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
        const newSrc = getAvatarUrl(cur);
        if (img.getAttribute('data-current') !== cur) {
            img.src = newSrc;
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
        try { _popperInstance.destroy(); } catch(e) {}
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
                try { _popperInstance.destroy(); } catch(e) {}
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
        h += '<div class="pg-quick-group' + (g.collapsed?' pg-collapsed':'') + '" data-gid="' + g.id + '">';
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
    window.jQuery(p).find('.pg-quick-group-header').on('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleCollapse(this.parentElement.dataset.gid);
        renderQuick();
        const popup = document.getElementById(POPUP_ID);
        if (popup) await positionQuick(popup);
    });
}

function renderQuickAv(a) {
    return '<div class="pg-quick-avatar' + (isCurrent(a)?' pg-current':'') + '" data-avatar="' + esc(a) + '" title="' + esc(getName(a)) + '"><img src="' + getAvatarUrl(a) + '"></div>';
}

// ========== 入口 ==========
jQuery(async () => {
    console.log('[' + EXT_NAME + '] Loading...');
    initStorage();
    await loadPersonaApi();
    loadPopper();
    await refreshValidAvatars();

    try { initMainPanel(); console.log('[' + EXT_NAME + '] Main panel initialized.'); }
    catch (err) { console.error('[' + EXT_NAME + '] Main panel init failed:', err); }

    const qp = extension_settings.quickPersona;
    if (qp && qp.enabled === true) {
        if (typeof toastr !== 'undefined') toastr.warning('Quick Persona enabled, quick popup disabled.', EXT_NAME);
    } else {
        try { initQuick(); console.log('[' + EXT_NAME + '] Quick panel initialized.'); }
        catch (err) { console.error('[' + EXT_NAME + '] Quick panel init failed:', err); }
    }

    const refreshAll = async () => {
        await refreshValidAvatars();
        try { refreshMain(); } catch(e){}
        try { refreshQuick(); } catch(e){}
    };
    if (eventSource && event_types) {
        if (event_types.SETTINGS_UPDATED) eventSource.on(event_types.SETTINGS_UPDATED, refreshAll);
        if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, refreshAll);
    }

    const obs = document.getElementById('user_avatar_block');
    if (obs) {
        new MutationObserver(() => {
            if (isReorganizing) return;
            clearTimeout(window.__pg_reorg_timer);
            window.__pg_reorg_timer = setTimeout(reorganizeNative, 100);
        }).observe(obs, { childList: true, subtree: false });
    }

    window.addEventListener('resize', () => {
        const p = document.getElementById(POPUP_ID);
        if (p && p.style.display !== 'none') {
            if (_popperInstance) {
                try { _popperInstance.update(); } catch(e) {}
            } else {
                positionQuick(p);
            }
        }
    });

    console.log('[' + EXT_NAME + '] Loaded successfully.');
});
