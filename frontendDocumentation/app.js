const API = "http://localhost:3000";
let token = null;
let userId = null;
let currentPlayingPath = null;
let selectedSongId = null;

/* ==============================
   LOGIN / REGISTER
================================*/
function showRegister() {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("registerBox").style.display = "block";
}

function showLogin() {
    document.getElementById("registerBox").style.display = "none";
    document.getElementById("loginBox").style.display = "block";
}

/* ==============================
   REGISTRO
================================*/
async function registerUser() {
    const username = document.getElementById("usernameReg").value;
    const email = document.getElementById("emailReg").value;
    const password = document.getElementById("passwordReg").value;

    if (!username || !email || !password) {
        alert("Faltan datos");
        return;
    }

    const res = await fetch(`${API}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();
    alert(data.message);

    if (res.ok) showLogin();
}

/* ==============================
   LOGIN
================================*/
async function login() {
    const email = document.getElementById("emailLogin").value;
    const password = document.getElementById("passwordLogin").value;

    const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
        alert(data.message || "Error al iniciar sesión");
        return;
    }

    // ASIGNAR TOKEN Y USUARIO
    token = data.token;
    userId = data.user.id;

    // YA PODEMOS CARGAR LAS PLAYLISTS DEL USUARIO
    await loadPlaylists();

    // MOSTRAR UI
    document.getElementById("userNameLabel").textContent = data.user.username;
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("registerBox").style.display = "none";
    document.getElementById("appWrapper").style.display = "flex";
    document.getElementById("playerBar").style.display = "flex";

    // VISTA INICIAL
    showView("songsView");

    // DEMÁS CARGAS
    await loadSongs();
    await loadArtists();
    await refreshPremiumBadge();
}

/* ==============================
   PREMIUM
================================*/
async function activatePremium() {
    if (!token) {
        alert("Primero inicia sesión");
        return;
    }

    const res = await fetch(`${API}/premium/activate`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await res.json();
    alert(data.message || "Respuesta de premium");
    await refreshPremiumBadge();
}

async function checkPremium() {
    if (!userId) {
        alert("Primero inicia sesión");
        return;
    }

    const res = await fetch(`${API}/premium/status/${userId}`);
    const data = await res.json();

    if (data.premium) {
        alert(`Tienes Premium activo hasta: ${new Date(data.end_date).toLocaleString()}`);
    } else {
        alert("No eres Premium");
    }

    await refreshPremiumBadge();
}

async function refreshPremiumBadge() {
    if (!userId) return;

    const res = await fetch(`${API}/premium/status/${userId}`);
    const data = await res.json();

    const badge = document.getElementById("premiumBadge");
    badge.style.display = data.premium ? "inline-flex" : "none";
}

/* ==============================
   CANCIONES
================================*/
async function loadSongs() {
    const res = await fetch(`${API}/songs`);
    const songs = await res.json();
    renderSongList("songList", songs, true);
}

// 🔧 AQUÍ ESTABA EL ERROR
function renderSongList(containerId, songs, highlightCurrent = false) {
    const list = document.getElementById(containerId);
    list.innerHTML = "";

    songs.forEach(song => {
        const wrapper = document.createElement("div");
        wrapper.className = "song";

        if (highlightCurrent && currentPlayingPath && song.file_path === currentPlayingPath) {
            wrapper.classList.add("playing");
        }

        const info = document.createElement("div");
        info.className = "song-info";

        const title = document.createElement("span");
        title.className = "song-title";
        title.textContent = song.title;

        const meta = document.createElement("span");
        meta.className = "song-meta";
        meta.textContent = `Artista ID: ${song.artist_id} • Álbum ID: ${song.album_id ?? "—"}`;

        info.appendChild(title);
        info.appendChild(meta);

        // Botón de play
        const playBtn = document.createElement("button");
        playBtn.className = "secondary";
        playBtn.textContent = "▶️";
        playBtn.onclick = () =>
            playSong(song.file_path, song.title, `Artista #${song.artist_id}`);

        // Botón de agregar a playlist
        const addBtn = document.createElement("button");
        addBtn.className = "secondary";
        addBtn.textContent = "➕";
        addBtn.onclick = () => openAddToPlaylist(song.id);

        // Contenedor de botones (derecha)
        const btnBox = document.createElement("div");
        btnBox.style.display = "flex";
        btnBox.style.gap = "6px";
        btnBox.appendChild(playBtn);
        btnBox.appendChild(addBtn);

        // Armamos el item
        wrapper.appendChild(info);
        wrapper.appendChild(btnBox);

        list.appendChild(wrapper);
    });
}

/* ==============================
   PLAYER
================================*/
function resolveSongUrl(filePath) {
    if (/^https?:\/\//i.test(filePath)) return filePath;
    const filename = filePath.split("/").pop();
    return `${API}/songs/${filename}`;
}

function playSong(path, title = "Desconocido", artist = "") {
    const audio = document.getElementById("player");
    const url = resolveSongUrl(path);

    currentPlayingPath = path;

    document.getElementById("nowTitle").textContent = title;
    document.getElementById("nowArtist").textContent = artist;

    audio.src = url;
    audio.play().catch(err => {
        console.error("Error reproduciendo:", err);
        alert("No se pudo reproducir la canción");
    });

    loadSongs().catch(() => {});
}

/* ==============================
   BUSCAR CANCIONES
================================*/
async function searchSongs() {
    const text = document.getElementById("searchInput").value;

    if (text.trim() === "") {
        document.getElementById("results").innerHTML = "";
        return;
    }

    const res = await fetch(`${API}/songs/search?query=${encodeURIComponent(text)}`);
    const songs = await res.json();

    renderSongList("results", songs, false);
}

/* ==============================
   SUBIR CANCIÓN
================================*/
async function uploadSong() {
    const title = document.getElementById("songTitle").value;
    const artist_id = document.getElementById("songArtist").value;
    const album_id = document.getElementById("songAlbum").value;
    const duration = document.getElementById("songDuration").value;
    const file = document.getElementById("songFile").files[0];

    if (!file) {
        alert("Selecciona un archivo MP3");
        return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("artist_id", artist_id);
    formData.append("album_id", album_id);
    formData.append("duration", duration);
    formData.append("song", file);

    const res = await fetch(`${API}/songs/upload`, {
        method: "POST",
        body: formData
    });

    const data = await res.json();
    alert(data.message);

    if (res.ok) loadSongs();
}

/* ==============================
   ARTISTAS
================================*/
async function createArtist() {
    const name = document.getElementById("artistName").value.trim();
    const desc = document.getElementById("artistDesc").value.trim();

    if (!name) {
        alert("El nombre del artista es obligatorio");
        return;
    }

    const res = await fetch(`${API}/artists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc })
    });

    const data = await res.json();
    alert(data.message || "Artista guardado");
    document.getElementById("artistName").value = "";
    document.getElementById("artistDesc").value = "";
    loadArtists();
}

async function loadArtists() {
    const res = await fetch(`${API}/artists`);
    const artists = await res.json();

    const artistList = document.getElementById("artistList");
    artistList.innerHTML = "";

    if (!artists.length) {
        artistList.innerHTML = "<p>No hay artistas aún.</p>";
        return;
    }

    artists.forEach(a => {
        const div = document.createElement("div");
        div.className = "artist-card";
        div.innerHTML = `
            <div>
                <strong>${a.name}</strong><br>
                <small>${a.description || "Sin descripción"}</small>
            </div>
            <button class="secondary" onclick="openArtistProfile(${a.id})">Ver perfil</button>
        `;
        artistList.appendChild(div);
    });
}

/* ==============================
   PERFIL DEL ARTISTA
================================*/
async function openArtistProfile(id) {
    showView("artistProfileView");

    const res = await fetch(`${API}/artists/${id}/full`);
    const data = await res.json();

    if (!res.ok) {
        alert(data.message || "Error al cargar el artista");
        return;
    }

    const artist = data.artist;

    document.getElementById("artistProfile").innerHTML = `
        <h2>${artist.name}</h2>
        <p>${artist.description || "Sin descripción"}</p>
    `;

    renderSongList("artistSongs", data.songs || [], false);
}

/* ==============================
   PLAYLISTS
================================*/
async function createPlaylist() {
    const name = playlistName.value.trim();
    if (!name) return alert("Escribe un nombre");

    const res = await fetch(`${API}/playlists`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name })
    });

    const data = await res.json();
    alert(data.message);

    if (res.ok) loadPlaylists();
}

async function loadPlaylists() {
    if (!userId) return;

    const res = await fetch(`${API}/playlists/${userId}`);
    const playlists = await res.json();

    const list = document.getElementById("playlistList");
    if (!list) return; // por si aún no está en el DOM

    list.innerHTML = "";

    playlists.forEach(pl => {
        const div = document.createElement("div");
        div.className = "song";

        div.innerHTML = `
            <div>
                <strong>${pl.name}</strong>
                <div class="song-meta">Playlist #${pl.id}</div>
            </div>
            <button class="secondary" onclick="openPlaylist(${pl.id})">📂 Abrir</button>
        `;

        list.appendChild(div);
    });
}

async function openPlaylist(id) {
    showView("playlistSongsView");

    const res = await fetch(`${API}/playlist/songs/${id}`);
    const songs = await res.json();

    document.getElementById("playlistTitle").textContent = "Playlist #" + id;
    renderSongList("playlistSongs", songs, false);
}

// Modal para elegir playlist a la que agregar la canción
async function openAddToPlaylist(songId) {
    selectedSongId = songId;

    const res = await fetch(`${API}/playlists/${userId}`);
    const playlists = await res.json();

    const box = document.getElementById("playlistOptions");
    box.innerHTML = "";

    playlists.forEach(pl => {
        const btn = document.createElement("button");
        btn.className = "primary";
        btn.textContent = pl.name;
        btn.style.width = "100%";
        btn.style.margin = "6px 0";
        btn.onclick = () => addSongToPlaylist(pl.id);
        box.appendChild(btn);
    });

    document.getElementById("playlistModal").style.display = "flex";
}

function closePlaylistModal() {
    document.getElementById("playlistModal").style.display = "none";
}

async function addSongToPlaylist(playlist_id) {
    const res = await fetch(`${API}/playlist/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playlist_id,
            song_id: selectedSongId
        })
    });

    const data = await res.json();
    alert(data.message);

    closePlaylistModal();
}

/* ==============================
   CAMBIO DE VISTAS (SIDEBAR)
================================*/
function showView(viewId) {
    const views = document.querySelectorAll(".view");
    views.forEach(v => v.style.display = "none");

    const target = document.getElementById(viewId);
    if (target) target.style.display = "block";
}
