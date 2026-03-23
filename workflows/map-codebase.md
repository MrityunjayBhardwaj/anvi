<purpose>Analyze codebase with parallel mapper agents. Forked from GSD.</purpose>

<process>
<step name="initialize">Determine focus areas: tech, arch, quality, concerns.</step>
<step name="spawn_mappers">
Spawn 4 parallel mapper agents:
```
Agent(subagent_type="anvi-codebase-mapper", description="Map: {focus}", prompt="Analyze codebase for {focus}...")
```
Fallback to gsd-codebase-mapper.
</step>
<step name="collect">Collect outputs to `.planning/codebase/`.</step>
<step name="commit">Commit codebase analysis.</step>
</process>
