const state = {
    currentUser: null,
    posts: [],
    configs: {
        modules: [],
        categories: []
    },
    users: []
};

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await syncSession();
});

function setupEventListeners() {
    document.getElementById('btn-login-trigger').onclick = login;

    ['login-user', 'login-pass'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                login();
            }
        });
    });

    document.getElementById('btn-logout-trigger').onclick = logout;

    document.getElementById('nav-view-btn').onclick = () => showTab('view');
    document.getElementById('nav-editor').onclick = () => {
        resetForm();
        showTab('create');
    };
    document.getElementById('nav-settings-btn').onclick = () => showTab('settings');

    document.getElementById('search-bar').oninput = renderCards;
    document.getElementById('filter-module').onchange = renderCards;
    document.getElementById('filter-category').onchange = renderCards;

    document.getElementById('btn-add-module').onclick = addModule;
    document.getElementById('btn-add-category').onclick = addCategory;
    document.getElementById('btn-create-user').onclick = createUser;

    document.getElementById('wiki-form').onsubmit = handleFormSubmit;
    document.getElementById('btn-cancel-edit').onclick = resetForm;

    document.getElementById('btn-close-modal').onclick = () => {
        document.getElementById('modal-detail').classList.add('hidden');
    };

    document.getElementById('post-files-problem').onchange = event => {
        const total = event.target.files.length;
        document.getElementById('label-files-problem').innerText = total > 0 ? `${total} arquivo(s)` : 'Nenhum';
    };

    document.getElementById('post-files-solution').onchange = event => {
        const total = event.target.files.length;
        document.getElementById('label-files-solution').innerText = total > 0 ? `${total} arquivo(s)` : 'Nenhum';
    };
}

async function syncSession() {
    try {
        const response = await apiRequest('/api/me');
        state.currentUser = response.user;
        await loadAppData();
        initAppUI();
    } catch (error) {
        showLoginScreen();
    }
}

async function login() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    try {
        const response = await apiRequest('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        state.currentUser = response.user;
        await loadAppData();
        initAppUI();
    } catch (error) {
        alert('Acesso negado.');
    }
}

async function logout() {
    try {
        await apiRequest('/api/logout', { method: 'POST' });
    } catch (error) {
        console.warn('Logout falhou:', error);
    }

    state.currentUser = null;
    state.posts = [];
    state.configs = { modules: [], categories: [] };
    state.users = [];
    showLoginScreen();
}

async function loadAppData() {
    const data = await apiRequest('/api/bootstrap');

    state.currentUser = data.user;
    state.posts = data.posts || [];
    state.configs = data.configs || { modules: [], categories: [] };
    state.users = data.users || [];
}

function showLoginScreen() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('modal-detail').classList.add('hidden');
}

function initAppUI() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    document.getElementById('logged-user-name').innerText = state.currentUser.username;
    document.getElementById('logged-user-role').innerText = roleLabel(state.currentUser.role);
    document.getElementById('user-initial').innerText = state.currentUser.username.charAt(0).toUpperCase();

    const canEdit = ['admin', 'editor'].includes(state.currentUser.role);
    const isAdmin = state.currentUser.role === 'admin';

    document.getElementById('nav-editor').classList.toggle('hidden', !canEdit);
    document.getElementById('section-admin').classList.toggle('hidden', !isAdmin);

    refreshDropdowns();
    renderAdminLists();
    renderCards();
    showTab('view');
}

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
    });

    document.querySelectorAll('.nav-item').forEach(button => {
        button.classList.remove('active');
    });

    const tabElement = document.getElementById(`tab-${tabId}`);
    if (tabElement) {
        tabElement.classList.remove('hidden');
    }

    const navMap = {
        view: 'nav-view-btn',
        create: 'nav-editor',
        settings: 'nav-settings-btn'
    };

    const navButton = document.getElementById(navMap[tabId]);
    if (navButton) {
        navButton.classList.add('active');
    }
}

async function handleFormSubmit(event) {
    event.preventDefault();

    const isEdit = document.getElementById('post-id').value.trim();
    const problemInput = document.getElementById('post-files-problem');
    const solutionInput = document.getElementById('post-files-solution');

    const existingPost = isEdit
        ? state.posts.find(post => String(post.id) === String(isEdit))
        : null;

    const newProblemFiles = await filesToBase64(problemInput.files);
    const newSolutionFiles = await filesToBase64(solutionInput.files);

    const payload = {
        title: document.getElementById('post-title').value.trim(),
        module: document.getElementById('post-module').value,
        category: document.getElementById('post-category').value,
        problem: document.getElementById('post-problem').value.trim(),
        solution: document.getElementById('post-solution').value.trim(),
        problemImages: newProblemFiles.length > 0 ? newProblemFiles : (existingPost?.problemImages || []),
        solutionImages: newSolutionFiles.length > 0 ? newSolutionFiles : (existingPost?.solutionImages || [])
    };

    if (!payload.title || !payload.module || !payload.category || !payload.problem || !payload.solution) {
        alert('Preencha título, módulo, categoria, problema e solução.');
        return;
    }

    try {
        if (isEdit) {
            await apiRequest(`/api/posts/${encodeURIComponent(isEdit)}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            await apiRequest('/api/posts', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        await loadAppData();
        refreshDropdowns();
        renderCards();
        resetForm();
        showTab('view');
        renderAdminLists();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível salvar o artigo.'));
    }
}

async function filesToBase64(fileList) {
    const files = Array.from(fileList || []);
    const allowedFiles = files.filter(file => file.type.startsWith('image/'));

    if (files.length !== allowedFiles.length) {
        alert('Alguns arquivos foram ignorados. Apenas imagens e GIFs são aceitos.');
    }

    return Promise.all(allowedFiles.map(file => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                resolve({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: reader.result
                });
            };

            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }));
}

function renderCards() {
    const grid = document.getElementById('wiki-grid');
    const search = document.getElementById('search-bar').value.toLowerCase();
    const filterModule = document.getElementById('filter-module').value;
    const filterCategory = document.getElementById('filter-category').value;

    grid.innerHTML = '';

    const filteredPosts = state.posts.filter(post => {
        const title = post.title || '';
        const module = post.module || '';
        const category = post.category || '';

        const matchesSearch = title.toLowerCase().includes(search);
        const matchesModule = !filterModule || module === filterModule;
        const matchesCategory = !filterCategory || category === filterCategory;

        return matchesSearch && matchesModule && matchesCategory;
    });

    if (filteredPosts.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-file-search"></i>
                <p>Nenhum artigo encontrado.</p>
            </div>
        `;
        return;
    }

    const canManage = state.currentUser && ['admin', 'editor'].includes(state.currentUser.role);

    filteredPosts.forEach(post => {
        const card = document.createElement('div');
        card.className = 'card';

        let actions = '';

        if (canManage) {
            actions = `
                <div class="action-btns">
                    <button onclick="loadEditForm('${escapeAttr(post.id)}', event)" title="Editar">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="del" onclick="deletePost('${escapeAttr(post.id)}', event)" title="Excluir">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            `;
        }

        const thumbnail = getPostThumbnail(post);
        const thumbnailHtml = thumbnail
            ? `
                <div class="card-thumb" onclick="openArticle('${escapeAttr(post.id)}')">
                    <img src="${thumbnail.data}" alt="${escapeAttr(thumbnail.name || 'Imagem do artigo')}">
                </div>
            `
            : '';

        const totalImages = countPostImages(post);
        const imageCounterHtml = totalImages > 0
            ? `<span><i class="ph ph-image"></i> ${totalImages} imagem(ns)</span>`
            : '';

        card.innerHTML = `
            ${thumbnailHtml}

            <div class="card-header">
                <div>
                    <span class="tag tag-module">${escapeHTML(post.module || '')}</span>
                    <span class="tag">${escapeHTML(post.category || '')}</span>
                </div>
                ${actions}
            </div>

            <h3 onclick="openArticle('${escapeAttr(post.id)}')">${escapeHTML(post.title || '')}</h3>

            <p onclick="openArticle('${escapeAttr(post.id)}')">
                ${escapeHTML((post.problem || '').substring(0, 120))}${(post.problem || '').length > 120 ? '...' : ''}
            </p>

            <div class="card-footer">
                <span><i class="ph ph-user"></i> ${escapeHTML(post.author || '')}</span>
                ${imageCounterHtml || `<span><i class="ph ph-calendar"></i> ${escapeHTML(formatDate(post.createdAt))}</span>`}
            </div>
        `;

        grid.appendChild(card);
    });
}

function getPostThumbnail(post) {
    if (post.problemImages && post.problemImages.length > 0) {
        return post.problemImages[0];
    }

    if (post.solutionImages && post.solutionImages.length > 0) {
        return post.solutionImages[0];
    }

    return null;
}

function countPostImages(post) {
    const problemCount = post.problemImages?.length || 0;
    const solutionCount = post.solutionImages?.length || 0;
    return problemCount + solutionCount;
}

async function deletePost(id, event) {
    event.stopPropagation();

    if (!confirm('Excluir card?')) {
        return;
    }

    try {
        await apiRequest(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadAppData();
        renderCards();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível excluir o artigo.'));
    }
}

function loadEditForm(id, event) {
    event.stopPropagation();

    const post = state.posts.find(item => String(item.id) === String(id));
    if (!post) return;

    document.getElementById('post-id').value = post.id;
    document.getElementById('post-title').value = post.title || '';
    document.getElementById('post-module').value = post.module || '';
    document.getElementById('post-category').value = post.category || '';
    document.getElementById('post-problem').value = post.problem || '';
    document.getElementById('post-solution').value = post.solution || '';

    document.getElementById('editor-title').innerText = 'Editar Artigo';
    document.getElementById('btn-save-post').innerText = 'Salvar Alterações';
    document.getElementById('btn-cancel-edit').classList.remove('hidden');

    const problemCount = post.problemImages?.length || 0;
    const solutionCount = post.solutionImages?.length || 0;

    document.getElementById('label-files-problem').innerText = problemCount > 0 ? `${problemCount} arquivo(s) salvo(s)` : 'Nenhum';
    document.getElementById('label-files-solution').innerText = solutionCount > 0 ? `${solutionCount} arquivo(s) salvo(s)` : 'Nenhum';

    showTab('create');
}

function resetForm() {
    document.getElementById('wiki-form').reset();
    document.getElementById('post-id').value = '';
    document.getElementById('editor-title').innerText = 'Novo Registro';
    document.getElementById('btn-save-post').innerText = 'Publicar na Wiki';
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    document.getElementById('label-files-problem').innerText = 'Nenhum';
    document.getElementById('label-files-solution').innerText = 'Nenhum';
}

async function addModule() {
    const input = document.getElementById('new-module-name');
    const value = input.value.trim();
    if (!value) return;

    try {
        await apiRequest('/api/configs', {
            method: 'POST',
            body: JSON.stringify({ type: 'module', value })
        });

        input.value = '';
        await loadAppData();
        refreshDropdowns();
        renderAdminLists();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível adicionar o módulo.'));
    }
}

async function addCategory() {
    const input = document.getElementById('new-category-name');
    const value = input.value.trim();
    if (!value) return;

    try {
        await apiRequest('/api/configs', {
            method: 'POST',
            body: JSON.stringify({ type: 'category', value })
        });

        input.value = '';
        await loadAppData();
        refreshDropdowns();
        renderAdminLists();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível adicionar a categoria.'));
    }
}

async function createUser() {
    const usernameInput = document.getElementById('new-username');
    const passwordInput = document.getElementById('new-password');
    const roleInput = document.getElementById('new-role');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const role = roleInput.value;

    if (!username || !password) return;

    try {
        await apiRequest('/api/users', {
            method: 'POST',
            body: JSON.stringify({
                username,
                password,
                role
            })
        });

        usernameInput.value = '';
        passwordInput.value = '';
        await loadAppData();
        renderAdminLists();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível criar o usuário.'));
    }
}

async function deleteConfig(type, item) {
    try {
        await apiRequest(`/api/configs/${encodeURIComponent(type)}/${encodeURIComponent(item)}`, {
            method: 'DELETE'
        });

        await loadAppData();
        refreshDropdowns();
        renderAdminLists();
        renderCards();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível remover o item.'));
    }
}

async function deleteUser(username) {
    if (username === 'admin') return;

    try {
        await apiRequest(`/api/users/${encodeURIComponent(username)}`, {
            method: 'DELETE'
        });

        await loadAppData();
        renderAdminLists();
    } catch (error) {
        alert(apiErrorMessage(error, 'Não foi possível remover o usuário.'));
    }
}

function renderAdminLists() {
    const modulesList = document.getElementById('list-modules');
    const categoriesList = document.getElementById('list-categories');
    const usersList = document.getElementById('list-users');

    modulesList.innerHTML = state.configs.modules.map(module => `
        <div class="list-item">
            <span>${escapeHTML(module)}</span>
            <button onclick="deleteConfig('module', '${escapeAttr(module)}')">Excluir</button>
        </div>
    `).join('');

    categoriesList.innerHTML = state.configs.categories.map(category => `
        <div class="list-item">
            <span>${escapeHTML(category)}</span>
            <button onclick="deleteConfig('category', '${escapeAttr(category)}')">Excluir</button>
        </div>
    `).join('');

    usersList.innerHTML = state.users.map(userData => `
        <div class="list-item">
            <span>${escapeHTML(userData.username)} (${escapeHTML(roleLabel(userData.role))})</span>
            ${
                userData.username !== 'admin'
                    ? `<button onclick="deleteUser('${escapeAttr(userData.username)}')">Remover</button>`
                    : ''
            }
        </div>
    `).join('');
}

function refreshDropdowns() {
    const modules = state.configs.modules || [];
    const categories = state.configs.categories || [];

    const moduleSelect = document.getElementById('post-module');
    const filterModuleSelect = document.getElementById('filter-module');
    const categorySelect = document.getElementById('post-category');
    const filterCategorySelect = document.getElementById('filter-category');

    moduleSelect.innerHTML = modules.map(module => `
        <option value="${escapeAttr(module)}">${escapeHTML(module)}</option>
    `).join('');

    categorySelect.innerHTML = categories.map(category => `
        <option value="${escapeAttr(category)}">${escapeHTML(category)}</option>
    `).join('');

    filterModuleSelect.innerHTML = `
        <option value="">Todos os Módulos</option>
        ${modules.map(module => `<option value="${escapeAttr(module)}">${escapeHTML(module)}</option>`).join('')}
    `;

    filterCategorySelect.innerHTML = `
        <option value="">Todas as Categorias</option>
        ${categories.map(category => `<option value="${escapeAttr(category)}">${escapeHTML(category)}</option>`).join('')}
    `;
}

function openArticle(id) {
    const post = state.posts.find(item => String(item.id) === String(id));
    if (!post) return;

    document.getElementById('modal-meta').innerHTML = `
        <span class="tag">${escapeHTML(post.module || '')}</span>
        <span class="tag">${escapeHTML(post.category || '')}</span>
    `;

    const problemImagesHtml = renderImageGallery(post.problemImages || []);
    const solutionImagesHtml = renderImageGallery(post.solutionImages || []);

    document.getElementById('modal-body').innerHTML = `
        <h1>${escapeHTML(post.title || '')}</h1>

        <div class="article-info">
            <span><i class="ph ph-user"></i> ${escapeHTML(post.author || '')}</span>
            <span><i class="ph ph-calendar"></i> Criado em ${escapeHTML(formatDate(post.createdAt))}</span>
            <span><i class="ph ph-clock"></i> Atualizado em ${escapeHTML(formatDate(post.updatedAt || post.createdAt))}</span>
        </div>

        <div class="content-box">
            <h4><i class="ph ph-warning-circle"></i> Problema</h4>
            <p>${formatText(post.problem || '')}</p>
            ${problemImagesHtml}
        </div>

        <div class="content-box">
            <h4><i class="ph ph-check-circle"></i> Solução</h4>
            <p>${formatText(post.solution || '')}</p>
            ${solutionImagesHtml}
        </div>
    `;

    document.getElementById('modal-detail').classList.remove('hidden');
}

function renderImageGallery(images) {
    if (!images || images.length === 0) return '';

    return `
        <div class="image-gallery">
            ${images.map(image => `
                <button
                    type="button"
                    class="article-image-link"
                    onclick="openImageViewer(${JSON.stringify(image.data)}, ${JSON.stringify(image.name || 'Imagem anexada')})"
                    title="${escapeAttr(image.name || 'Imagem anexada')}"
                >
                    <img
                        src="${image.data}"
                        alt="${escapeAttr(image.name || 'Imagem anexada')}"
                        class="article-image"
                    >
                    <div class="image-name">
                        ${escapeHTML(image.name || 'Imagem anexada')}
                    </div>
                </button>
            `).join('')}
        </div>
    `;
}

function formatText(text) {
    return escapeHTML(text).replace(/\n/g, '<br>');
}

function formatDate(value) {
    if (!value) return 'Sem data';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return new Intl.DateTimeFormat('pt-BR').format(date);
}

function roleLabel(role) {
    const map = {
        admin: 'ADMIN',
        editor: 'EDITOR',
        reader: 'LEITOR'
    };

    return map[role] || String(role || '').toUpperCase();
}

function escapeHTML(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
    return escapeHTML(value).replaceAll('`', '&#096;');
}

function apiErrorMessage(error, fallback) {
    const map = {
        unauthorized: 'Sua sessão expirou. Faça login novamente.',
        invalid_credentials: 'Usuário ou senha inválidos.',
        forbidden: 'Você não tem permissão para executar essa ação.',
        forbidden_user: 'Não é permitido remover esse usuário.',
        user_exists: 'Esse usuário já existe.',
        invalid_role: 'Cargo inválido.',
        invalid_type: 'Tipo inválido.',
        missing_fields: 'Preencha todos os campos obrigatórios.',
        missing_value: 'Informe um valor.',
        post_not_found: 'Artigo não encontrado.'
    };

    return map[error?.message] || fallback;
}

async function openImageViewer(imageData, imageName) {
    const oldViewer = document.querySelector('.image-viewer-overlay');
    if (oldViewer) {
        oldViewer.remove();
    }

    const viewer = document.createElement('div');
    viewer.className = 'image-viewer-overlay';

    viewer.innerHTML = `
        <div class="image-viewer-box">
            <button class="image-viewer-close" type="button" title="Fechar">
                <i class="ph ph-x"></i>
            </button>

            <img src="${imageData}" alt="${escapeAttr(imageName)}">

            <div class="image-viewer-name">
                ${escapeHTML(imageName)}
            </div>
        </div>
    `;

    viewer.addEventListener('click', event => {
        const clickedOutside = event.target === viewer;
        const clickedClose = event.target.closest('.image-viewer-close');

        if (clickedOutside || clickedClose) {
            viewer.remove();
        }
    });

    document.addEventListener('keydown', function closeOnEsc(event) {
        if (event.key === 'Escape') {
            viewer.remove();
            document.removeEventListener('keydown', closeOnEsc);
        }
    });

    document.body.appendChild(viewer);
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
        const error = new Error(data?.error || `http_${response.status}`);
        error.status = response.status;
        error.payload = data;
        throw error;
    }

    return data;
}
