import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as habit_app


class AdminActivityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.original_database = habit_app.DATABASE
        cls.original_admin_allowlist = habit_app.app.config["ADMIN_ALLOWLIST_EMAIL"]
        habit_app.DATABASE = Path(cls.temp_dir.name) / "admin-activity.sqlite3"
        habit_app.app.config.update(TESTING=True, SECRET_KEY="admin-activity-test-secret")
        with habit_app.app.app_context():
            habit_app.init_db()

    @classmethod
    def tearDownClass(cls):
        habit_app.DATABASE = cls.original_database
        habit_app.app.config["ADMIN_ALLOWLIST_EMAIL"] = cls.original_admin_allowlist
        cls.temp_dir.cleanup()

    def setUp(self):
        habit_app.app.config["ADMIN_ALLOWLIST_EMAIL"] = "owner@example.test"
        with habit_app.app.app_context():
            habit_app.get_db().execute("DELETE FROM users")
            habit_app.get_db().commit()
        self.owner = habit_app.app.test_client()
        self.member = habit_app.app.test_client()
        self.owner_csrf = self._csrf(self.owner)
        self.member_csrf = self._csrf(self.member)

    @staticmethod
    def _csrf(client):
        return client.get("/api/auth/me").get_json()["csrf_token"]

    @staticmethod
    def _request(client, token, method, path, body=None):
        return client.open(
            path,
            method=method,
            json=body,
            headers={"X-CSRF-Token": token},
        )

    def _register(self, client, token, name, email):
        response = self._request(
            client,
            token,
            "POST",
            "/api/auth/register",
            {"name": name, "email": email, "password": "safe-test-password"},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()["csrf_token"]

    def _make_owner_admin(self):
        with habit_app.app.app_context():
            db = habit_app.get_db()
            db.execute(
                "UPDATE users SET role = 'admin' WHERE email = ?",
                ("owner@example.test",),
            )
            db.commit()

    def test_admin_activity_page_and_api_require_the_designated_admin(self):
        self.assertEqual(self.owner.get("/admin").status_code, 302)
        self.assertEqual(self.owner.get("/api/admin/activity").status_code, 401)
        self.owner_csrf = self._register(
            self.owner, self.owner_csrf, "Owner", "owner@example.test"
        )
        self.assertEqual(self.owner.get("/admin").status_code, 403)

        with habit_app.app.app_context():
            db = habit_app.get_db()
            db.execute(
                "UPDATE users SET role = 'admin' WHERE email = ?",
                ("owner@example.test",),
            )
            db.commit()
        page = self.owner.get("/admin")
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.headers["Cache-Control"], "no-store")
        self.assertIn(b"Activity overview", page.data)

        self.member_csrf = self._register(
            self.member, self.member_csrf, "Sam", "sam@example.test"
        )
        with habit_app.app.app_context():
            habit_app.get_db().execute(
                "UPDATE users SET role = 'admin' WHERE email = ?",
                ("sam@example.test",),
            )
            habit_app.get_db().commit()
        self.assertFalse(self.member.get("/api/auth/me").get_json()["user"]["is_admin"])
        self.assertEqual(self.member.get("/admin").status_code, 403)
        self.assertEqual(self.member.get("/api/admin/activity").status_code, 403)

    def test_bootstrap_rejects_an_admin_outside_the_allowlist(self):
        with habit_app.app.app_context():
            with patch.dict(
                "os.environ",
                {
                    "ADMIN_EMAIL": "other@example.test",
                    "ADMIN_NAME": "Other Admin",
                    "ADMIN_PASSWORD": "safe-owner-password",
                },
                clear=False,
            ):
                with self.assertRaisesRegex(RuntimeError, "must match"):
                    habit_app.bootstrap_admin(habit_app.get_db())

    def test_activity_counts_signups_and_successful_signins(self):
        self.owner_csrf = self._register(
            self.owner, self.owner_csrf, "Owner", "owner@example.test"
        )
        self._make_owner_admin()
        self.member_csrf = self._register(
            self.member, self.member_csrf, "Sam", "sam@example.test"
        )
        self.member_csrf = self._request(
            self.member, self.member_csrf, "POST", "/api/auth/logout", {}
        ).get_json()["csrf_token"]
        signed_in = self._request(
            self.member,
            self.member_csrf,
            "POST",
            "/api/auth/login",
            {"email": "sam@example.test", "password": "safe-test-password"},
        )
        self.assertEqual(signed_in.status_code, 200, signed_in.get_json())

        activity = self.owner.get("/api/admin/activity")
        self.assertEqual(activity.status_code, 200, activity.get_json())
        self.assertEqual(activity.headers["Cache-Control"], "no-store")
        data = activity.get_json()
        self.assertEqual(data["accounts"], 2)
        self.assertEqual(data["users_signed_in"], 2)
        self.assertEqual(data["sign_ins"], 3)
        self.assertEqual(data["sign_ins_7d"], 3)
        self.assertEqual(data["active_users_7d"], 2)
        self.assertEqual(data["signups_30d"], 2)
        self.assertEqual(len(data["recent_activity"]), 5)
        self.assertTrue(
            any(entry["event_type"] == "signup" for entry in data["recent_activity"])
        )
        self.assertTrue(
            any(entry["email"] == "sam@example.test" for entry in data["recent_activity"])
        )

    def test_failed_signin_is_not_recorded(self):
        self.owner_csrf = self._register(
            self.owner, self.owner_csrf, "Owner", "owner@example.test"
        )
        self._make_owner_admin()
        rejected = self._request(
            self.owner,
            self.owner_csrf,
            "POST",
            "/api/auth/login",
            {"email": "owner@example.test", "password": "wrong-password"},
        )
        self.assertEqual(rejected.status_code, 401)
        data = self.owner.get("/api/admin/activity").get_json()
        self.assertEqual(data["sign_ins"], 1)
