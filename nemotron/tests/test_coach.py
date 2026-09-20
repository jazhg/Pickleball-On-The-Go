import json
import unittest
from nemotron.coach import select_cue
from nemotron.transport import ModelError

class Client:
    def __init__(self, answer): self.answer = answer
    def complete(self, messages, **kwargs): return {'content': self.answer}

class CoachTests(unittest.TestCase):
    def test_model_selects_a_trajectory_specific_decision(self):
        events = [{'type':'bounce','x':0,'z':-8}]
        ruling = {'rule':'out','score':[0,0]}
        result = select_cue(events,ruling,live=True,client=Client('{"cue":"soften_power","evidence_index":0}'))
        self.assertEqual(result['cue'],'soften_power');self.assertEqual(result['path'],'model')
        self.assertEqual(ruling['score'],[0,0])
    def test_invalid_or_invented_model_decisions_are_rejected(self):
        for answer in ['invalid', 'null', '[]', '{"cue":"point_red","evidence_index":0}',
                       '{"cue":"reduce_angle","evidence_index":100}', '{"cue":"reduce_angle","evidence_index":true}',
                       '{"cue":"reduce_angle","evidence_index":0,"score":[99,0]}',
                       '{"cue":[],"evidence_index":0}']:
            result=select_cue([{'type':'bounce'}],{'rule':'out'},live=True,client=Client(answer))
            self.assertEqual(result['path'],'fallback')
    def test_offline_never_claims_a_model_decision(self):
        result=select_cue([{'type':'bounce'}],{'rule':'two_bounces'})
        self.assertEqual(result['path'],'baseline');self.assertEqual(result['cue'],'move_to_ball')
    def test_network_failure_falls_back(self):
        class Failed:
            def complete(self,*args,**kwargs): raise ModelError('timeout')
        self.assertEqual(select_cue([{}],{'rule':'out'},live=True,client=Failed())['path'],'fallback')
