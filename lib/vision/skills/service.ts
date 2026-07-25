import type {
  VisionSkillInput,
  VisionSkillName,
  VisionSkillResult,
} from './contracts.ts';
import { visionSkillRegistry, type VisionSkillRegistry } from './registry.ts';

export function createVisionSkillService(
  registry: VisionSkillRegistry = visionSkillRegistry,
) {
  return {
    execute(input: {
      skill: VisionSkillName;
      data: VisionSkillInput;
    }): VisionSkillResult {
      return registry.get(input.skill).execute(input.data);
    },

    availableSkills(): readonly VisionSkillName[] {
      return registry.list();
    },
  };
}

export type VisionSkillService = ReturnType<typeof createVisionSkillService>;
