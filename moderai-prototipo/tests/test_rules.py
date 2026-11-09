"""Ejecutar: python -m unittest discover -s tests (sin Azure ni modelo)."""
import unittest
import asyncio
import httpx
from unittest.mock import MagicMock, patch
from fastapi import FastAPI
from api.rules import router


class Client:
    def __init__(self, app):
        self.app = app

    def request(self, method, path, **kwargs):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test") as client:
                return await client.request(method, path, **kwargs)
        return asyncio.run(run())

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self.request("POST", path, **kwargs)


class RulesTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = Client(app)
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.mock = patch("api.rules.connect_database")
        self.mock.start().return_value.__enter__.return_value = self.connection
        self.addCleanup(self.mock.stop)
        self.headers = {"Authorization": "Bearer " + "a" * 64}

    def test_auth_required(self):
        self.assertEqual(self.client.get("/api/reglas").status_code, 401)
        self.assertEqual(self.client.get("/api/reglas", headers={"Authorization": "Bearer bad"}).status_code, 401)

    def test_list_is_scoped_to_token_owner(self):
        self.cursor.fetchone.return_value = {"id_usuario": "owner-a"}
        self.cursor.fetchall.return_value = []
        result = self.client.get("/api/reglas?id_usuario=someone-else", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        query, params = self.cursor.execute.call_args.args
        self.assertIn("WHERE id_usuario = %s", query)
        self.assertEqual(params, ("owner-a",))

    def test_create_ignores_supplied_owner_and_id(self):
        self.cursor.lastrowid = 7
        self.cursor.fetchone.side_effect = [{"id_usuario": "owner-a"}, {"id_regla": 7, "id_usuario": "owner-a"}]
        result = self.client.post("/api/reglas", headers=self.headers, json={"id_usuario": "attacker", "id_regla": 999, "prompt": "  fútbol  ", "categoria": "CUSTOM_PROMPT"})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.json()["id_regla"], 7)
        self.assertEqual(self.cursor.execute.call_args_list[1].args[1], ("owner-a", "fútbol", "CUSTOM_PROMPT", "Normal"))
        self.connection.commit.assert_called_once()

    def test_invalid_rule(self):
        for prompt, category in [("  ", "SPOILER"), ("texto", "INVALID"), ("x" * 2001, "SPAM")]:
            self.assertEqual(self.client.post("/api/reglas", headers=self.headers, json={"prompt": prompt, "categoria": category}).status_code, 422)

    def test_unknown_installation(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.client.get("/api/reglas", headers=self.headers).status_code, 401)

    def test_registration_stores_hash_and_is_repeatable(self):
        self.cursor.fetchone.return_value = None
        result = self.client.post("/api/instalacion", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        digest, user_id = self.cursor.execute.call_args.args[1]
        self.assertNotEqual(digest, "a" * 64)
        self.assertEqual(user_id, result.json()["id_usuario"])
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = {"id_usuario": user_id}
        self.assertEqual(self.client.post("/api/instalacion", headers=self.headers).json()["id_usuario"], user_id)
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_failure_rolls_back_without_leaking_details(self):
        self.cursor.execute.side_effect = RuntimeError("secret-password")
        result = self.client.get("/api/reglas", headers=self.headers)
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("secret-password", result.text)
        self.connection.rollback.assert_called_once()
        self.cursor.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
