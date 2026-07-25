import {
  CleanlinessSkill,
  ClosingReadinessSkill,
  EquipmentSkill,
  OpeningReadinessSkill,
  SafetySkill,
} from './built-in-skills.ts';
import type { VisionSkill, VisionSkillName } from './contracts.ts';

export class VisionSkillRegistry {
  readonly #skills = new Map<VisionSkillName, VisionSkill>();

  register(skill: VisionSkill): this {
    if (this.#skills.has(skill.name)) throw new Error('VISION_SKILL_ALREADY_REGISTERED');
    this.#skills.set(skill.name, skill);
    return this;
  }

  get(name: VisionSkillName): VisionSkill {
    const skill = this.#skills.get(name);
    if (!skill) throw new Error('VISION_SKILL_NOT_REGISTERED');
    return skill;
  }

  list(): readonly VisionSkillName[] {
    return Object.freeze([...this.#skills.keys()]);
  }
}

export function createVisionSkillRegistry(): VisionSkillRegistry {
  return new VisionSkillRegistry()
    .register(new OpeningReadinessSkill())
    .register(new ClosingReadinessSkill())
    .register(new CleanlinessSkill())
    .register(new SafetySkill())
    .register(new EquipmentSkill());
}

export const visionSkillRegistry = createVisionSkillRegistry();
