-- Ejecutar como administrador en Workbench. No elimina datos existentes.
USE moderai;
CREATE TABLE IF NOT EXISTS identidad_extension (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  id_usuario VARCHAR(45) NOT NULL,
  FOREIGN KEY (id_usuario) REFERENCES usuario_config(id_usuario) ON DELETE CASCADE
);
