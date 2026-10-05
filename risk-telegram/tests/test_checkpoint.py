import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import relay


class ReceiptCheckpointTests(unittest.TestCase):
    def test_receipt_checkpoint_retries_only_unchanged_state(self):
        with patch.object(relay, 'github', side_effect=[relay.SafeError('http_409'), {'content': {'sha': 'saved'}}]) as write, patch.object(relay, 'read_state', return_value=({'receipts': {}}, 'expected')), patch.object(relay.time, 'sleep'), patch.object(relay, 'telegram') as send:
            self.assertEqual(relay.save_state({'receipts': {}}, 'expected'), 'saved')
            self.assertEqual(write.call_count, 2)
            self.assertTrue(all(call.args[1]['sha'] == 'expected' for call in write.call_args_list))
            send.assert_not_called()

    def test_changed_receipt_state_stops_before_send(self):
        saved = {'receipts': {}}
        with patch.object(relay, 'github', side_effect=relay.SafeError('http_409')) as write, patch.object(relay, 'read_state', return_value=({'receipts': {'other': {'status': 'sent'}}}, 'newer')), patch.object(relay, 'telegram') as send:
            with self.assertRaisesRegex(relay.SafeError, 'telegram_state_compare_and_swap_conflict'):
                relay.deliver(saved, {'chat_id': 'test'}, 'expected', 'digest', 'test')
            self.assertEqual(write.call_count, 1)
            send.assert_not_called()


if __name__ == '__main__':
    unittest.main()
