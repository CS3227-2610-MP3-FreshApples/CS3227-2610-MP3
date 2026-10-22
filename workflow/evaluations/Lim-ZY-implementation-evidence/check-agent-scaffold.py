from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]
ROLE_FILES = {
    "analyst": ("read-only", "analyst.md"),
    "architect": ("read-only", "architect.md"),
    "implementation": ("workspace-write", "implementation.md"),
    "code_quality_test_generator": (
        "workspace-write",
        "code-quality-test-generator.md",
    ),
    "reviewer_tester": ("read-only", "reviewer-tester.md"),
}
REQUIRED_PROMPT_HEADINGS = (
    "## Purpose",
    "## Sources of Truth",
    "## Permitted Work",
    "## Prohibited Work",
    "## Required Handoff",
    "## Human Approval Gates",
)


config = tomllib.loads((ROOT / ".codex/config.toml").read_text())
agents = config["agents"]
assert agents["max_threads"] == 5
assert agents["max_depth"] == 1

for role, (expected_sandbox, prompt_name) in ROLE_FILES.items():
    registration = agents[role]
    assert registration["config_file"] == f"agents/{role}.toml"

    role_config = tomllib.loads(
        (ROOT / ".codex/agents" / f"{role}.toml").read_text()
    )
    assert role_config["sandbox_mode"] == expected_sandbox
    assert role_config["name"] == role
    assert role_config["description"]
    assert "model" not in role_config
    assert f"workflow/agents/{prompt_name}" in role_config["developer_instructions"]

    prompt = (ROOT / "workflow/agents" / prompt_name).read_text()
    for heading in REQUIRED_PROMPT_HEADINGS:
        assert heading in prompt, f"{prompt_name}: missing {heading}"
    assert "git commit" in prompt.lower()
    assert "deploy" in prompt.lower()

quality_prompt = (ROOT / "workflow/agents/code-quality-test-generator.md").read_text()
assert "tests/" in quality_prompt
assert "explicitly assigned" in quality_prompt
assert "production code" in quality_prompt

for path in (
    ROOT / "workflow/README.md",
    ROOT / "workflow/handoffs/.gitkeep",
    ROOT / "workflow/evaluations/.gitkeep",
):
    assert path.exists(), f"missing {path.relative_to(ROOT)}"

print("agent scaffold checks passed")
