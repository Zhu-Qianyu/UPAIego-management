"""Tests for the readable name generation logic (simple incrementing numbers)."""

from app.services.device_service import register_device, delete_device, generate_device_id_pair


class TestNameGeneration:
    def test_first_device_gets_1(self, db_session):
        did, name = generate_device_id_pair(db_session)
        dev = register_device(db_session, did, name)
        assert dev.readable_name == "1"

    def test_sequential_names(self, db_session):
        did1, name1 = generate_device_id_pair(db_session)
        d1 = register_device(db_session, did1, name1)

        did2, name2 = generate_device_id_pair(db_session)
        d2 = register_device(db_session, did2, name2)

        did3, name3 = generate_device_id_pair(db_session)
        d3 = register_device(db_session, did3, name3)

        assert d1.readable_name == "1"
        assert d2.readable_name == "2"
        assert d3.readable_name == "3"

    def test_no_name_reuse_after_delete(self, db_session):
        did1, name1 = generate_device_id_pair(db_session)
        d1 = register_device(db_session, did1, name1)

        did2, name2 = generate_device_id_pair(db_session)
        d2 = register_device(db_session, did2, name2)

        did3, name3 = generate_device_id_pair(db_session)
        d3 = register_device(db_session, did3, name3)
        assert d3.readable_name == "3"

        delete_device(db_session, did2)

        did4, name4 = generate_device_id_pair(db_session)
        d4 = register_device(db_session, did4, name4)
        assert d4.readable_name == "4"

    def test_duplicate_raises(self, db_session):
        did, name = generate_device_id_pair(db_session)
        register_device(db_session, did, name)
        try:
            register_device(db_session, did, "99")
            assert False, "Should have raised ValueError"
        except ValueError as e:
            assert "already registered" in str(e)

    def test_generate_pair_returns_uuid_and_name(self, db_session):
        device_id, readable_name = generate_device_id_pair(db_session)
        assert len(device_id) == 36  # UUID4 format
        assert readable_name == "1"
