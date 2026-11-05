"""r013 draft uses the existing isolated engine, with explicit unresolved boundaries."""
import copy
from .complex import ComplexSession
from .engine import Session

MODEL_ID = 'SIM-IS-TW-IR-R013'


class R013Session(ComplexSession):
    def actions(self, device):
        if device.get('controlBlocked'):
            return []
        actions = super().actions(device)
        # No site-specific black-start or condenser capability is established by r013.
        return [a for a in actions if a not in {'mode_condense', 'black_start'}]

    def _has_aux(self, station, bootstrap=False):
        # An explicit training boundary, not a fictitious station-service connection.
        return bool(self.model['assumptions']['auxiliariesAvailable'] and self.states[station+'-DC']['available'])

    def _permissives(self, device, action, completing=False):
        if device.get('controlBlocked'):
            return [dict(code='UNVERIFIED_TOPOLOGY',message=device['verification']['note'])]
        failures=super()._permissives(device,action,completing)
        associated=device['parameters'].get('associatedBreaker')
        if device['type']=='isolator' and associated and self.states[associated]['position']!='open':
            failures.append(dict(code='LOAD_BREAK_NOT_PERMITTED',message='Open the associated breaker before operating this isolator.'))
        return failures

    def _advance_transfer(self, dt):
        pass  # Missing supply wiring must not become an automatic transfer path.

    def _advance_water(self, dt):
        for station in ['IS','TF','IR']:
            state=self.states[station+'-POND'];params=self._device(station+'-POND')['parameters']
            flow=sum(self.states[d['equipmentId']]['flowM3S'] for d in self._generators() if d['parameters']['station']==station)
            state['storageM3']=max(0,state['storageM3']+(params['inflowM3S']-flow)*dt)
            state.update(headwaterM=100+state['storageM3']/params['areaM2'],turbineFlowM3S=flow,spillFlowM3S=0,totalFlowM3S=flow)

    def snapshot(self):
        result=super().snapshot()
        result.update(r013=True,drawingBindings=copy.deepcopy(self.model['drawingBindings']))
        return result

    def finish(self):
        result=Session.finish(self)
        achieved=bool(self.unit['milestones'].get('unit_online') and self.unit['milestones'].get('normal_stop'))
        result.update(objectiveAchieved=achieved,milestones=copy.deepcopy(self.unit['milestones']))
        for event in [self.events[-1],result['events'][-1]]:
            if event['kind']=='session_completed':event['detail']['objectiveAchieved']=achieved
        self.debriefs[-1]=copy.deepcopy(result)
        return result
