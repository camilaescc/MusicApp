
require("dotenv").config();
const express = require("express");
const cors = require("cors"); // <-- Importar CORS
const path = require("path");
const app = express();
const db = require("./connection");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

app.use(cors()); // <-- Habilitar CORS para que tu frontend pueda conectarse


app.use(express.json());

const multer = require("multer");

// Configurar almacenamiento
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, path.join(__dirname, "public", "songs"));
    },
    filename: function(req, file, cb) {
        const unique = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
        cb(null, unique);
    }
});

const upload = multer({ storage: storage });

// =============================
// 🔊 SERVIR ARCHIVOS DE AUDIO
// =============================
// Carpeta: /public/songs  →  URL: http://localhost:3000/songs/archivo.mp3
app.use("/songs", express.static(path.join(__dirname, "public", "songs")));

// =============================
// 🔐 MIDDLEWARE: VERIFICAR TOKEN (por si luego quieres proteger rutas)
// =============================
function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: "Token requerido" });
    }

    // authHeader puede ser "Bearer <token>" o solo "<token>"
    const parts = authHeader.split(" ");
    const token = parts.length === 2 ? parts[1] : parts[0];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id: ... }
        next();
    } catch (err) {
        console.log("❌ Error verificando token:", err.message);
        res.status(401).json({ message: "Token inválido" });
    }
}


// =============================
// 🔐 VERIFICAR SI ES PREMIUM
// =============================
function onlyPremium(req, res, next) {
    const userId = req.user.id;

    const sql = `
        SELECT plan 
        FROM subscriptions 
        WHERE user_id = ? 
        AND (end_date IS NULL OR end_date > NOW())
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al verificar plan" });

        if (results.length === 0 || results[0].plan !== "premium") {
            return res.status(403).json({ message: "Requiere cuenta Premium" });
        }

        next();
    });
}


// =============================
// 👤 USUARIOS
// =============================

// REGISTRO
app.post("/register", (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
        return res.status(400).json({ message: "Faltan datos" });

    const hashed = bcrypt.hashSync(password, 10);

    const sql = "INSERT INTO usuarios (username, email, password) VALUES (?, ?, ?)";

    db.query(sql, [username, email, hashed], (err) => {
        if (err) {
            console.log("❌ Error al registrar usuario:", err);
            return res.status(500).json({ message: "Error al registrar" });
        }
        res.json({ message: "Usuario registrado" });
    });
});

// LOGIN
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.query("SELECT * FROM usuarios WHERE email = ?", [email], (err, results) => {
        if (err) return res.status(500).json({ message: "Error servidor" });
        if (results.length === 0) return res.status(400).json({ message: "No existe" });

        const user = results[0];

        if (!bcrypt.compareSync(password, user.password))
            return res.status(401).json({ message: "Contraseña incorrecta" });

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        res.json({ message: "Login exitoso", token, user: { id: user.id, username: user.username, email: user.email } });
    });
});

// ACTIVAR PREMIUM (7 días de prueba, ejemplo)
app.post("/premium/activate", auth, (req, res) => {
    const userId = req.user.id;

    const sql = `
        INSERT INTO subscriptions (user_id, plan, start_date, end_date)
        VALUES (?, 'premium', NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))
    `;

    db.query(sql, [userId], (err) => {
        if (err) {
            console.log("❌ Error al activar premium:", err);
            return res.status(500).json({ message: "Error al activar premium" });
        }

        res.json({ message: "Cuenta Premium activada por 30 días" });
    });
});


// LISTAR USUARIOS
app.get("/usuarios", (req, res) => {
    db.query("SELECT id, username, email FROM usuarios", (err, results) => {
        if (err) return res.status(500).json({ message: "Error" });
        res.json(results);
    });
});

// ELIMINAR USUARIO
app.delete("/usuarios/:id", (req, res) => {
    db.query("DELETE FROM usuarios WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Error" });
        res.json({ message: "Usuario eliminado" });
    });
});

// =============================
// 🎤 ARTISTS (usa tu tabla: id, name, description)
// =============================

// PERFIL COMPLETO DE ARTISTA (datos + sus canciones)
app.get("/artists/:id/full", (req, res) => {
    const artistId = req.params.id;

    const sqlArtist = "SELECT * FROM artists WHERE id = ?";
    const sqlSongs = "SELECT * FROM songs WHERE artist_id = ?";

    db.query(sqlArtist, [artistId], (err, artistResults) => {
        if (err) {
            console.log("❌ Error al obtener artista:", err);
            return res.status(500).json({ message: "Error al obtener artista" });
        }

        if (artistResults.length === 0) {
            return res.status(404).json({ message: "Artista no encontrado" });
        }

        const artist = artistResults[0];

        db.query(sqlSongs, [artistId], (err2, songResults) => {
            if (err2) {
                console.log("❌ Error al obtener canciones del artista:", err2);
                return res.status(500).json({ message: "Error al obtener canciones" });
            }

            res.json({
                artist,
                songs: songResults
            });
        });
    });
});


// CREAR ARTISTA
app.post("/artists", (req, res) => {
    const { name, description } = req.body;

    if (!name) return res.status(400).json({ message: "El nombre es obligatorio" });

    db.query(
        "INSERT INTO artists (name, description) VALUES (?, ?)",
        [name, description || null],
        (err, result) => {
            if (err) {
                console.log("❌ Error al crear artista:", err);
                return res.status(500).json({ message: "Error al crear artista" });
            }
            res.json({ message: "Artista creado", id: result.insertId });
        }
    );
});

// LISTAR TODOS LOS ARTISTAS
app.get("/artists", (req, res) => {
    db.query("SELECT * FROM artists", (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener artistas" });
        res.json(results);
    });
});

// OBTENER UN ARTISTA POR ID
app.get("/artists/:id", (req, res) => {
    db.query("SELECT * FROM artists WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener artista" });
        res.json(results[0] || null);
    });
});

// EDITAR ARTISTA
app.put("/artists/:id", (req, res) => {
    const { name, description } = req.body;

    db.query(
        "UPDATE artists SET name = ?, description = ? WHERE id = ?",
        [name, description || null, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ message: "Error al actualizar artista" });
            res.json({ message: "Artista actualizado" });
        }
    );
});

// ELIMINAR ARTISTA
app.delete("/artists/:id", (req, res) => {
    db.query("DELETE FROM artists WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Error al eliminar artista" });
        res.json({ message: "Artista eliminado" });
    });
});

// =============================
// 💿 ALBUMS (tabla: id, artist_id, title, cover_path)
// =============================

// CREAR ÁLBUM
app.post("/albums", (req, res) => {
    const { artist_id, title, cover_path } = req.body;

    if (!artist_id || !title || !cover_path)
        return res.status(400).json({ message: "artist_id, title y cover_path son obligatorios" });

    db.query(
        "INSERT INTO albums (artist_id, title, cover_path) VALUES (?, ?, ?)",
        [artist_id, title, cover_path],
        (err, result) => {
            if (err) {
                console.log("❌ Error al crear álbum:", err);
                return res.status(500).json({ message: "Error al crear álbum" });
            }
            res.json({ message: "Álbum creado", id: result.insertId });
        }
    );
});

// LISTAR TODOS LOS ÁLBUMES
app.get("/albums", (req, res) => {
    db.query("SELECT * FROM albums", (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener álbumes" });
        res.json(results);
    });
});

// ÁLBUM POR ID
app.get("/albums/:id", (req, res) => {
    db.query("SELECT * FROM albums WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener álbum" });
        res.json(results[0] || null);
    });
});

// ÁLBUMES POR ARTISTA
app.get("/albums/artist/:artist_id", (req, res) => {
    db.query("SELECT * FROM albums WHERE artist_id = ?", [req.params.artist_id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener álbumes del artista" });
        res.json(results);
    });
});

// ACTUALIZAR ÁLBUM
app.put("/albums/:id", (req, res) => {
    const { artist_id, title, cover_path } = req.body;

    db.query(
        "UPDATE albums SET artist_id = ?, title = ?, cover_path = ? WHERE id = ?",
        [artist_id, title, cover_path, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ message: "Error al actualizar álbum" });
            res.json({ message: "Álbum actualizado" });
        }
    );
});

// ELIMINAR ÁLBUM
app.delete("/albums/:id", (req, res) => {
    db.query("DELETE FROM albums WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Error al eliminar álbum" });
        res.json({ message: "Álbum eliminado" });
    });
});

// =============================
// 🎵 SONGS  (usa tu tabla: id, album_id, artist_id, title, file_path, duration)
// =============================

// =============================
// 🎵 CREAR CANCIÓN CON DETECCIÓN AUTOMÁTICA DE ÁLBUM
// =============================
app.post("/songs", (req, res) => {
    const { title, artist_id, album_title, file_path, duration } = req.body;

    if (!title || !artist_id || !file_path || !duration || !album_title) {
        return res.status(400).json({
            message: "title, artist_id, album_title, file_path y duration son obligatorios"
        });
    }

    // 1. Verificar si el álbum ya existe
    const checkAlbumSql = "SELECT id FROM albums WHERE title = ? LIMIT 1";

    db.query(checkAlbumSql, [album_title], (err, albumResult) => {
        if (err) {
            console.log("❌ Error al buscar álbum:", err);
            return res.status(500).json({ message: "Error al buscar álbum" });
        }

        if (albumResult.length > 0) {
            // Ya existe el álbum → usar su ID
            insertSong(albumResult[0].id);
        } else {
            // 2. Crear álbum automáticamente
            const createAlbumSql =
                "INSERT INTO albums (artist_id, title, cover_path) VALUES (?, ?, ?)";

            db.query(
                createAlbumSql,
                [artist_id, album_title, "default.jpg"],
                (err, newAlbum) => {
                    if (err) {
                        console.log("❌ Error al crear álbum:", err);
                        return res.status(500).json({ message: "Error al crear álbum" });
                    }

                    insertSong(newAlbum.insertId);
                }
            );
        }
    });

    // 3. Insertar canción una vez que tenemos álbum
    function insertSong(album_id) {
        const sql = `
            INSERT INTO songs (album_id, artist_id, title, file_path, duration)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(sql, [album_id, artist_id, title, file_path, duration], (err, result) => {
            if (err) {
                console.log("❌ Error al insertar canción:", err);
                return res.status(500).json({ message: "Error al crear canción" });
            }

            res.json({
                message: "Canción creada correctamente",
                song_id: result.insertId,
                album_id
            });
        });
    }
});


// =============================
// 📤 SUBIR ARCHIVO DE CANCIÓN
// =============================
app.post("/songs/upload", upload.single("song"), (req, res) => {
    const { title, artist_id, album_id, duration } = req.body;

    if (!req.file) {
        return res.status(400).json({ message: "No se subió ningún archivo" });
    }

    const file_path = req.file.filename; // nombre con el que se guardó

    const sql = `
        INSERT INTO songs (album_id, artist_id, title, file_path, duration)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [album_id || null, artist_id, title, file_path, duration], (err, result) => {
        if (err) {
            console.log("❌ Error al guardar canción:", err);
            return res.status(500).json({ message: "Error al guardar canción" });
        }
        res.json({ 
            message: "Canción subida correctamente",
            id: result.insertId,
            file_path 
        });
    });
});

// LISTAR CANCIONES
app.get("/songs", (req, res) => {
    db.query("SELECT * FROM songs", (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener canciones" });
        res.json(results);
    });
});

// OBTENER UNA CANCIÓN
app.get("/songs/:id", (req, res) => {
    db.query("SELECT * FROM songs WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al obtener canción" });
        res.json(results[0] || null);
    });
});

// DESCARGAR CANCIÓN (solo PREMIUM)
app.get("/songs/download/:id", auth, onlyPremium, (req, res) => {
    db.query("SELECT file_path FROM songs WHERE id = ?", [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error" });
        if (results.length === 0) return res.status(404).json({ message: "Canción no encontrada" });

        const file = path.join(__dirname, "public", "songs", results[0].file_path);
        res.download(file);
    });
});

// =============================
// 🔍 BUSCAR CANCIONES
// =============================
app.get("/songs/search", (req, res) => {
    const query = req.query.query;

    if (!query || query.trim() === "") {
        return res.status(400).json({ message: "Falta ?query= en la URL" });
    }

    const sql = `
        SELECT songs.*, artists.name AS artist_name, albums.title AS album_title
        FROM songs
        LEFT JOIN artists ON songs.artist_id = artists.id
        LEFT JOIN albums ON songs.album_id = albums.id
        WHERE songs.title LIKE ?
        OR artists.name LIKE ?
        OR albums.title LIKE ?
    `;

    const like = `%${query}%`;

    db.query(sql, [like, like, like], (err, results) => {
        if (err) {
            console.log("❌ Error al buscar canciones:", err);
            return res.status(500).json({ message: "Error al buscar" });
        }
        res.json(results);
    });
});


// =============================
// 🎧 PLAYLISTS
// =============================

app.post("/playlists", auth, (req, res) => {
    const { name } = req.body;
    const userId = req.user.id;

    // Primero revisamos si es premium
    const sqlCheck = `
        SELECT plan FROM subscriptions 
        WHERE user_id = ? AND (end_date IS NULL OR end_date > NOW())
    `;

    db.query(sqlCheck, [userId], (err, results) => {
        if (err) return res.status(500).json({ message: "Error al verificar plan" });

        const isPremium = results.length > 0 && results[0].plan === "premium";

        // Si NO es premium, revisamos límite
        if (!isPremium) {
            db.query("SELECT COUNT(*) AS total FROM playlists WHERE user_id = ?", [userId], (err, countRes) => {
                if (err) return res.status(500).json({ message: "Error al contar playlists" });

                if (countRes[0].total >= 3) {
                    return res.status(403).json({
                        message: "Los usuarios gratuitos solo pueden crear 3 playlists"
                    });
                }

                // Crear playlist porque está debajo del límite
                createPlaylist();
            });
        } else {
            createPlaylist(); // Premium puede crear ilimitadas
        }

        function createPlaylist() {
            db.query(
                "INSERT INTO playlists (user_id, name) VALUES (?, ?)",
                [userId, name],
                (err) => {
                    if (err) return res.status(500).json({ message: "Error" });
                    res.json({ message: "Playlist creada" });
                }
            );
        }
    });
});


// LISTAR PLAYLISTS POR USUARIO
app.get("/playlists/:user_id", (req, res) => {
    db.query(
        "SELECT * FROM playlists WHERE user_id = ?",
        [req.params.user_id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error" });
            res.json(results);
        }
    );
});

// AGREGAR CANCIÓN A PLAYLIST
app.post("/playlist/add", (req, res) => {
    const { playlist_id, song_id } = req.body;

    db.query(
        "INSERT INTO playlist_songs (playlist_id, song_id) VALUES (?, ?)",
        [playlist_id, song_id],
        (err) => {
            if (err) return res.status(500).json({ message: "Error" });
            res.json({ message: "Canción agregada" });
        }
    );
});

// VER CANCIONES DE UNA PLAYLIST
app.get("/playlist/songs/:playlist_id", (req, res) => {
    db.query(
        `SELECT songs.* 
         FROM playlist_songs 
         JOIN songs ON songs.id = playlist_songs.song_id 
         WHERE playlist_songs.playlist_id = ?`,
        [req.params.playlist_id],
        (err, results) => {
            if (err) return res.status(500).json({ message: "Error" });
            res.json(results);
        }
    );
});

// QUITAR CANCIÓN
app.delete("/playlist/remove", (req, res) => {
    const { playlist_id, song_id } = req.body;

    db.query(
        "DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?",
        [playlist_id, song_id],
        (err) => {
            if (err) return res.status(500).json({ message: "Error" });
            res.json({ message: "Canción removida" });
        }
    );
});

// ELIMINAR PLAYLIST
app.delete("/playlists/:id", (req, res) => {
    db.query("DELETE FROM playlists WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ message: "Error" });
        res.json({ message: "Playlist eliminada" });
    });
});

// =============================
// ⭐ SUBSCRIPTIONS (Planes premium)
// Tabla: subscriptions(id, user_id, plan, start_date, end_date)
// =============================

// ACTIVAR PREMIUM
app.post("/premium/activate", (req, res) => {
    const { user_id } = req.body;

    if (!user_id)
        return res.status(400).json({ message: "Falta user_id" });

    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + 1); // 1 mes premium

    const sql = `
        INSERT INTO subscriptions (user_id, plan, start_date, end_date)
        VALUES (?, 'premium', ?, ?)
        ON DUPLICATE KEY UPDATE plan='premium', start_date=?, end_date=?`;

    db.query(sql, [user_id, start, end, start, end], (err) => {
        if (err) {
            console.log("❌ Error al activar premium:", err);
            return res.status(500).json({ message: "Error al activar premium" });
        }
        res.json({ message: "Premium activado correctamente", start, end });
    });
});

// VER SI UN USUARIO ES PREMIUM
app.get("/premium/status/:user_id", (req, res) => {
    const user_id = req.params.user_id;

    const sql = `
        SELECT * FROM subscriptions
        WHERE user_id = ? AND plan = 'premium' AND end_date > NOW()`;

    db.query(sql, [user_id], (err, results) => {
        if (err) {
            console.log("❌ Error al consultar status:", err);
            return res.status(500).json({ message: "Error al consultar status" });
        }

        if (results.length === 0) {
            return res.json({ premium: false, message: "Usuario no es premium" });
        }

        res.json({
            premium: true,
            message: "Usuario premium activo",
            start_date: results[0].start_date,
            end_date: results[0].end_date
        });
    });
});

// MIDDLEWARE PARA BLOQUEAR FUNCIONES PREMIUM
function requirePremium(req, res, next) {
    const user_id = req.headers["user-id"];

    if (!user_id) return res.status(400).json({ message: "Falta user-id en headers" });

    const sql = `
        SELECT * FROM subscriptions
        WHERE user_id = ? AND plan = 'premium' AND end_date > NOW()`;

    db.query(sql, [user_id], (err, results) => {
        if (err) {
            console.log("❌ Error premium:", err);
            return res.status(500).json({ message: "Error" });
        }

        if (results.length === 0) {
            return res.status(403).json({ 
                message: "No eres premium, actualiza tu plan para usar esta función" 
            });
        }

        next();
    });
}



// =============================
// SERVIDOR
// =============================
app.listen(process.env.PORT || 3000, () => {
    console.log("🚀 Servidor corriendo en puerto " + (process.env.PORT || 3000));
});
