"""병해충별 예측 모델 플러그인 패키지.

규약: ``models/<작물>/<병해충>/`` 폴더마다
- ``model.yaml``  모델 카드(메타데이터·입력변수·파라미터·근거)
- ``model.py``    ``Model`` 클래스(``models._base.interface.BaseModel`` 상속)
- ``eval.json``   백테스트 결과(``pipeline/backtest.py``가 갱신)

폴더를 추가하면 ``models._base.registry.discover()``가 자동으로 찾는다.
"""
