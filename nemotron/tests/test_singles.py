import unittest
from unittest.mock import patch
from nemotron.singles import review
from nemotron.transport import ModelError

class SinglesReviewTests(unittest.TestCase):
    def test_structured_review_and_provider_failure(self):
        with patch('nemotron.singles.NvidiaClient') as client:
            client.return_value.complete.return_value = {'content': '{"player":"B","reason":"double_bounce","explanation":"Blue failed to return before the second bounce."}'}
            self.assertEqual(review({'fault': {'player': 'B', 'reason': 'double_bounce'}})['player'], 'B')
            self.assertEqual(client.return_value.complete.call_args.kwargs['model'], 'lightning')
            client.return_value.complete.side_effect = ModelError('timeout')
            self.assertIsNone(review({}))
    def test_rejects_unstructured_or_extra_model_fields(self):
        with patch('nemotron.singles.NvidiaClient') as client:
            for content in ['not json', '{"player":"C","reason":"out","explanation":"Fault"}', '{"player":"A","reason":"out","explanation":"Fault","score":[99,0]}']:
                client.return_value.complete.return_value = {'content': content}
                self.assertIsNone(review({}))
