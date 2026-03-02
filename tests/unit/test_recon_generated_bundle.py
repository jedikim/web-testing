from src.recon.models import GeneratedBundle


def test_generated_bundle_defaults() -> None:
    bundle = GeneratedBundle(
        workflow_dsl={"steps": []},
        prompts={"extract": "x"},
        strategy="dom_only",
        dependencies=["playwright"],
    )
    assert bundle.python_macro is None
    assert bundle.ts_macro is None
    assert bundle.workflow_dsl["steps"] == []
