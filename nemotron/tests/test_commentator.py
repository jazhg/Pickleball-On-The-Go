import unittest
from nemotron.commentator import choose_clip

class Client:
    def __init__(self, content):
        self.content = content
    def complete(self, messages, **kwargs):
        return {'content': self.content}

class CommentatorTests(unittest.TestCase):
    def test_valid_selection_and_silence(self):
        self.assertEqual(choose_clip({'hits': 8}, ['rally'], Client('{"clip":"rally"}')), 'rally')
        self.assertIsNone(choose_clip({}, ['drive'], Client('{"clip":null}')))

    def test_model_cannot_invent_calls_or_choose_ineligible_praise(self):
        for content in ['{"clip":"fault_red"}', '{"clip":"angle"}', '{"clip":"drive","extra":1}', 'not json']:
            self.assertIsNone(choose_clip({}, ['drive'], Client(content)))
        self.assertIsNone(choose_clip({}, ['point_red'], Client('{"clip":"point_red"}')))
