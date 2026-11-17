"""Configuracion local y preservacion del TLS predeterminado."""
import os
import unittest
from unittest.mock import patch, MagicMock
from api.database import connection_options, check_database, TABLES


class DatabaseConfigTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "DB_HOST": "db", "DB_USER": "moderai",
            "DB_PASSWORD": "test-only", "DB_NAME": "moderai"
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_tls_remains_required_by_default(self):
        with self.assertRaisesRegex(ValueError, "DB_SSL_CA"):
            connection_options()

    def test_explicit_local_mode_does_not_require_certificate(self):
        os.environ["DB_SSL_MODE"] = "disabled"
        options = connection_options()
        self.assertTrue(options["ssl_disabled"])
        self.assertNotIn("ssl_ca", options)

    def test_unknown_ssl_mode_rejected(self):
        os.environ["DB_SSL_MODE"] = "typo"
        with self.assertRaises(ValueError):
            connection_options()

    def test_default_tls_verifies_identity(self):
        os.environ["DB_SSL_CA"] = "test-ca.pem"
        with patch("api.database.Path.is_file", return_value=True):
            options = connection_options()
        self.assertTrue(options["ssl_verify_identity"])
        self.assertTrue(options["ssl_verify_cert"])
        self.assertFalse(options["ssl_disabled"])

    def test_local_health_reports_real_tls_status_and_identity_table(self):
        os.environ["DB_SSL_MODE"] = "disabled"
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = ("Ssl_cipher", "")
        with patch("api.database.connect_database") as connect:
            connect.return_value.__enter__.return_value = connection
            result = check_database()
        self.assertTrue(result["listo"])
        self.assertFalse(result["tls"])
        self.assertIn("identidad_extension", result["tablas_verificadas"])
        self.assertEqual(connection.cursor.return_value.execute.call_count, 1 + len(TABLES))

    def test_remote_health_rejects_unencrypted_session(self):
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = ("Ssl_cipher", "")
        with patch("api.database.connect_database") as connect:
            connect.return_value.__enter__.return_value = connection
            with self.assertRaisesRegex(RuntimeError, "TLS"):
                check_database()
