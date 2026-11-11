import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as habit_app


class HabitTrackerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.original_database = habit_app.DATABASE
        habit_app.DATABASE = Path(cls.temp_dir.name) / "test.sqlite3"
        habit_app.app.config.update(TESTING=True, SECRET_KEY="test-secret")
        with habit_app.app.app_context():
            habit_app.init_db()

    @classmethod
    def tearDownClass(cls):
        habit_app.DATABASE = cls.original_database
        cls.temp_dir.cleanup()

    def setUp(self):
        with habit_app.app.app_context():
            habit_app.get_db().execute("DELETE FROM users")
            habit_app.get_db().commit()
        self.client = habit_app.app.test_client()
        self.second_client = habit_app.app.test_client()
        self.csrf = self._get_csrf(self.client)
        self.second_csrf = self._get_csrf(self.second_client)

    @staticmethod
    def _get_csrf(client):
        response = client.get("/api/auth/me")
        return response.get_json()["csrf_token"]

    def _request(self, client, token, method, path, json=None):
        return client.open(
            path,
            method=method,
            json=json,
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

    def test_registration_creates_hashed_password_and_private_user(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        identity = self.client.get("/api/auth/me").get_json()
        self.assertTrue(identity["authenticated"])
        self.assertEqual(identity["user"]["name"], "Alex")
        self.assertEqual(identity["user"]["role"], "user")

        with habit_app.app.app_context():
            row = habit_app.get_db().execute(
                "SELECT password_hash FROM users WHERE email = ?",
                ("alex@example.test",),
            ).fetchone()
            self.assertNotEqual(row["password_hash"], "safe-test-password")
            self.assertTrue(habit_app.check_password_hash(row["password_hash"], "safe-test-password"))

    def test_admin_permissions_manage_roles_accounts_and_global_usage(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        self.second_csrf = self._register(
            self.second_client, self.second_csrf, "Sam", "sam@example.test"
        )
        self.assertEqual(self.client.get("/api/admin/users").status_code, 403)
        self.assertEqual(self.client.get("/api/admin/habits").status_code, 403)
        self.assertEqual(
            self._request(
                self.client,
                self.csrf,
                "POST",
                "/api/admin/users/2/habits",
                {"name": "Admin-only action"},
            ).status_code,
            403,
        )

        with habit_app.app.app_context():
            db = habit_app.get_db()
            db.execute("UPDATE users SET role = 'admin' WHERE email = ?", ("alex@example.test",))
            db.commit()
        identity = self.client.get("/api/auth/me").get_json()
        self.assertEqual(identity["user"]["role"], "admin")
        self.csrf = identity["csrf_token"]

        created = self._request(
            self.second_client,
            self.second_csrf,
            "POST",
            "/api/habits",
            {"name": "Read", "frequency": "daily"},
        )
        self.assertEqual(created.status_code, 201)
        global_habits = self.client.get("/api/admin/habits").get_json()
        self.assertEqual(len(global_habits), 1)
        self.assertEqual(global_habits[0]["user_email"], "sam@example.test")
        managed_habit = self._request(
            self.client,
            self.csrf,
            "PUT",
            f"/api/admin/habits/{created.get_json()['id']}",
            {"name": "Read every day", "category": "Education", "frequency": "daily"},
        )
        self.assertEqual(managed_habit.status_code, 200, managed_habit.get_json())
        owned_by_another_user = self.second_client.get("/api/habits").get_json()
        self.assertEqual(owned_by_another_user[0]["name"], "Read every day")
        overview = self.client.get("/api/admin/overview").get_json()
        self.assertEqual(overview, {"users": 2, "admins": 1, "habits": 1, "completions": 0})
        created_for_user = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/admin/users/2/habits",
            {"name": "Hydrate", "category": "Health", "frequency": "daily"},
        )
        self.assertEqual(created_for_user.status_code, 201, created_for_user.get_json())
        globally_deleted = self._request(
            self.client,
            self.csrf,
            "DELETE",
            f"/api/admin/habits/{created.get_json()['id']}",
        )
        self.assertEqual(globally_deleted.status_code, 200)
        self.assertEqual(
            [habit["name"] for habit in self.second_client.get("/api/habits").get_json()],
            ["Hydrate"],
        )

        promoted = self._request(
            self.client, self.csrf, "PUT", "/api/admin/users/2/role", {"role": "admin"}
        )
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(self.second_client.get("/api/auth/me").get_json()["user"]["role"], "admin")

        demoted = self._request(
            self.client, self.csrf, "PUT", "/api/admin/users/2/role", {"role": "user"}
        )
        self.assertEqual(demoted.status_code, 200)
        deleted = self._request(self.client, self.csrf, "DELETE", "/api/admin/users/2")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/admin/habits").get_json(), [])
        self.assertEqual(self.client.get("/api/admin/users").get_json()[0]["email"], "alex@example.test")

    def test_admin_cannot_delete_or_demote_the_last_admin(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        with habit_app.app.app_context():
            habit_app.get_db().execute(
                "UPDATE users SET role = 'admin' WHERE email = ?", ("alex@example.test",)
            )
            habit_app.get_db().commit()
        role_change = self._request(
            self.client, self.csrf, "PUT", "/api/admin/users/1/role", {"role": "user"}
        )
        self.assertEqual(role_change.status_code, 409)
        deletion = self._request(self.client, self.csrf, "DELETE", "/api/admin/users/1")
        self.assertEqual(deletion.status_code, 409)
        self.assertEqual(self.client.get("/api/auth/me").get_json()["user"]["role"], "admin")

    def test_env_bootstrap_creates_one_admin_once(self):
        with habit_app.app.app_context():
            db = habit_app.get_db()
            db.execute("DELETE FROM users")
            db.execute("DELETE FROM app_settings WHERE key = 'admin_env_bootstrapped'")
            db.commit()
            with patch.dict(
                "os.environ",
                {
                    "ADMIN_EMAIL": "owner@example.test",
                    "ADMIN_NAME": "Workspace Owner",
                    "ADMIN_PASSWORD": "safe-owner-password",
                },
                clear=False,
            ):
                habit_app.bootstrap_admin(db)
                db.execute("UPDATE users SET role = 'user' WHERE email = ?", ("owner@example.test",))
                habit_app.bootstrap_admin(db)
            row = db.execute(
                "SELECT role, password_hash FROM users WHERE email = ?", ("owner@example.test",)
            ).fetchone()
            self.assertEqual(row["role"], "user")
            self.assertTrue(habit_app.check_password_hash(row["password_hash"], "safe-owner-password"))

    def test_init_db_migrates_existing_users_to_the_user_role(self):
        original_database = habit_app.DATABASE
        with tempfile.TemporaryDirectory() as temp_dir:
            habit_app.DATABASE = Path(temp_dir) / "legacy.sqlite3"
            try:
                with habit_app.app.app_context():
                    db = habit_app.get_db()
                    db.execute(
                        """CREATE TABLE users (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                        password_hash TEXT NOT NULL,
                        freeze_tokens INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                        )"""
                    )
                    db.commit()
                    with patch.dict(
                        "os.environ",
                        {"ADMIN_EMAIL": "", "ADMIN_NAME": "", "ADMIN_PASSWORD": ""},
                    ):
                        habit_app.init_db()
                    db.execute(
                        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                        ("Legacy User", "legacy@example.test", "hash"),
                    )
                    db.commit()
                    role = db.execute(
                        "SELECT role FROM users WHERE email = ?", ("legacy@example.test",)
                    ).fetchone()["role"]
                self.assertEqual(role, "user")
            finally:
                habit_app.DATABASE = original_database

    def test_promote_admin_requires_existing_valid_account(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        with self.assertRaises(ValueError):
            with habit_app.app.app_context():
                habit_app.promote_admin("missing@example.test")
        with habit_app.app.app_context():
            self.assertEqual(habit_app.promote_admin("ALEX@example.test"), "alex@example.test")
            role = habit_app.get_db().execute(
                "SELECT role FROM users WHERE email = ?", ("alex@example.test",)
            ).fetchone()["role"]
        self.assertEqual(role, "admin")

    def test_habit_completion_journal_mood_and_analytics_round_trip(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        habit = {
            "name": "A short walk",
            "description": "Take a small break outside.",
            "category": "Health",
            "frequency": "selected",
            "selected_days": [0, 2, 4],
            "preferred_time": "09:30",
            "reminder_time": "10:00",
            "icon": "fa-person-walking",
            "color": "#5c8466",
        }
        created = self._request(self.client, self.csrf, "POST", "/api/habits", habit)
        self.assertEqual(created.status_code, 201, created.get_json())
        habit_id = created.get_json()["id"]
        today = habit_app.date.today().isoformat()

        completion = self._request(
            self.client,
            self.csrf,
            "POST",
            f"/api/habits/{habit_id}/complete",
            {"date": today},
        )
        self.assertEqual(completion.status_code, 200, completion.get_json())
        self.assertTrue(completion.get_json()["completed"])
        dashboard = self.client.get(f"/api/dashboard?date={today}").get_json()
        self.assertEqual(dashboard["summary"]["total_completions"], 1)

        journal = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/journal",
            {"date": today, "accomplished": "I went outside."},
        )
        self.assertEqual(journal.status_code, 200)
        mood = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/mood",
            {"date": today, "mood": "Motivated"},
        )
        self.assertEqual(mood.status_code, 200)

        saved = self.client.get(f"/api/journal?date={today}").get_json()
        self.assertEqual(saved["entry"]["accomplished"], "I went outside.")
        analytics = self.client.get("/api/analytics").get_json()
        self.assertEqual(analytics["total_completions"], 1)
        self.assertEqual(analytics["mood_counts"]["Motivated"], 1)

    def test_owner_can_edit_and_delete_a_habit(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        created = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/habits",
            {"name": "Read", "category": "Education", "frequency": "daily"},
        )
        habit_id = created.get_json()["id"]
        updated = self._request(
            self.client,
            self.csrf,
            "PUT",
            f"/api/habits/{habit_id}",
            {"name": "Read one page", "category": "Education", "frequency": "daily"},
        )
        self.assertEqual(updated.status_code, 200)
        habits = self.client.get("/api/habits").get_json()
        self.assertEqual(habits[0]["name"], "Read one page")
        deleted = self._request(
            self.client,
            self.csrf,
            "DELETE",
            f"/api/habits/{habit_id}",
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/habits").get_json(), [])

    def test_users_cannot_read_or_modify_each_others_habits(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        self.second_csrf = self._register(
            self.second_client, self.second_csrf, "Sam", "sam@example.test"
        )
        created = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/habits",
            {"name": "Private habit", "category": "Other", "frequency": "daily"},
        )
        habit_id = created.get_json()["id"]
        self.assertEqual(self.second_client.get("/api/habits").get_json(), [])
        self.assertEqual(
            self._request(
                self.second_client,
                self.second_csrf,
                "DELETE",
                f"/api/habits/{habit_id}",
            ).status_code,
            404,
        )

    def test_users_cannot_read_each_others_journal_mood_or_analytics(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        self.second_csrf = self._register(
            self.second_client, self.second_csrf, "Sam", "sam@example.test"
        )
        today = habit_app.date.today().isoformat()
        created = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/habits",
            {"name": "Private habit", "frequency": "daily"},
        )
        habit_id = created.get_json()["id"]
        self._request(
            self.client,
            self.csrf,
            "POST",
            f"/api/habits/{habit_id}/complete",
            {"date": today},
        )
        self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/journal",
            {"date": today, "accomplished": "Private reflection"},
        )
        self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/mood",
            {"date": today, "mood": "Motivated"},
        )

        self.assertIsNone(self.second_client.get(f"/api/journal?date={today}").get_json()["entry"])
        self.assertEqual(self.second_client.get("/api/mood").get_json(), [])
        dashboard = self.second_client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["habits"], [])
        self.assertEqual(dashboard["summary"]["total_completions"], 0)
        analytics = self.second_client.get("/api/analytics").get_json()
        self.assertEqual(analytics["total_completions"], 0)
        self.assertEqual(sum(analytics["mood_counts"].values()), 0)

    def test_invalid_date_queries_are_rejected(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        for path in (
            "/api/dashboard?date=2026-02-31",
            "/api/habits?date=not-a-date",
            "/api/journal?date=not-a-date",
        ):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.get_json())

    def test_habit_times_must_be_valid_clock_times(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        for field, value in (("preferred_time", "99:99"), ("reminder_time", "24:00")):
            with self.subTest(field=field):
                response = self._request(
                    self.client,
                    self.csrf,
                    "POST",
                    "/api/habits",
                    {"name": "A routine", field: value},
                )
                self.assertEqual(response.status_code, 400)

    def test_mutations_require_csrf_token(self):
        response = self.client.post(
            "/api/auth/register",
            json={"name": "Alex", "email": "alex@example.test", "password": "safe-test-password"},
        )
        self.assertEqual(response.status_code, 403)

    def test_profile_update_requires_current_password_for_password_change(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        rejected = self._request(
            self.client,
            self.csrf,
            "PUT",
            "/api/auth/profile",
            {"name": "Alex", "current_password": "wrong", "new_password": "another-safe-password"},
        )
        self.assertEqual(rejected.status_code, 400)
        changed = self._request(
            self.client,
            self.csrf,
            "PUT",
            "/api/auth/profile",
            {
                "name": "Alexandra",
                "current_password": "safe-test-password",
                "new_password": "another-safe-password",
            },
        )
        self.assertEqual(changed.status_code, 200, changed.get_json())
        self.assertEqual(changed.get_json()["user"]["name"], "Alexandra")

    def test_logout_rotates_csrf_token_and_allows_later_login(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        logged_out = self._request(self.client, self.csrf, "POST", "/api/auth/logout", {})
        self.assertEqual(logged_out.status_code, 200)
        next_token = logged_out.get_json()["csrf_token"]
        self.assertFalse(self.client.get("/api/auth/me").get_json()["authenticated"])
        logged_in = self._request(
            self.client,
            next_token,
            "POST",
            "/api/auth/login",
            {"email": "alex@example.test", "password": "safe-test-password"},
        )
        self.assertEqual(logged_in.status_code, 200, logged_in.get_json())
        self.assertTrue(self.client.get("/api/auth/me").get_json()["authenticated"])

    def test_selected_days_require_a_valid_weekday(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        response = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/habits",
            {"name": "Walk", "frequency": "selected", "selected_days": [7]},
        )
        self.assertEqual(response.status_code, 400)

    def test_weekly_habit_is_due_until_completed_once_this_week(self):
        self.csrf = self._register(self.client, self.csrf, "Alex", "alex@example.test")
        created = self._request(
            self.client,
            self.csrf,
            "POST",
            "/api/habits",
            {"name": "Weekly reflection", "frequency": "weekly"},
        )
        habit_id = created.get_json()["id"]
        today = habit_app.date.today()
        monday = (today - habit_app.timedelta(days=today.weekday())).isoformat()
        first_dashboard = self.client.get(f"/api/dashboard?date={monday}").get_json()
        self.assertTrue(first_dashboard["habits"][0]["due"])
        completion = self._request(
            self.client,
            self.csrf,
            "POST",
            f"/api/habits/{habit_id}/complete",
            {"date": monday},
        )
        self.assertEqual(completion.status_code, 200)
        after_completion = self.client.get(
            f"/api/dashboard?date={today.isoformat()}"
        ).get_json()
        if today.isoformat() == monday:
            self.assertTrue(after_completion["habits"][0]["completed"])
        else:
            self.assertFalse(after_completion["habits"][0]["due"])

    def test_flask_entry_point_renders_app_shell(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="auth-screen"', response.data)
        self.assertIn(b"/static/js/app.js", response.data)
        overview = self.client.get("/overview")
        self.assertEqual(overview.status_code, 200)
        overview.close()
        static_response = self.client.get("/static/css/style.css")
        self.assertEqual(static_response.status_code, 200)
        static_response.close()

    def test_postgres_adapter_translates_sqlite_placeholders_and_date_modifier(self):
        class FakeConnection:
            def __init__(self):
                self.statement = None
                self.parameters = None

            def execute(self, statement, parameters):
                self.statement = statement
                self.parameters = parameters
                return "cursor"

        connection = FakeConnection()
        adapter = habit_app.PostgresConnection(connection)
        result = adapter.execute(
            "SELECT id FROM completions WHERE user_id = ? AND completed_on >= date(?, '-11 months')",
            (7, "2026-11-01"),
        )
        self.assertEqual(result, "cursor")
        self.assertEqual(
            connection.statement,
            "SELECT id FROM completions WHERE user_id = %s AND completed_on >= "
            "to_char(%s::date - INTERVAL '11 months', 'YYYY-MM-DD')",
        )
        self.assertEqual(connection.parameters, (7, "2026-11-01"))

        adapter.execute("BEGIN IMMEDIATE")
        self.assertEqual(connection.statement, "BEGIN")

    def test_postgres_rows_support_named_and_positional_access(self):
        class FakeColumn:
            name = "user_id"

        class FakeCursor:
            description = [FakeColumn()]

        row_factory = habit_app.hybrid_row(FakeCursor())
        row = row_factory((42,))
        self.assertEqual(row["user_id"], 42)
        self.assertEqual(row[0], 42)

        class EmptyCursor:
            description = None

        self.assertIs(habit_app.hybrid_row(EmptyCursor()), tuple)


if __name__ == "__main__":
    unittest.main()
