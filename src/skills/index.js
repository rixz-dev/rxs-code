// Skill registry
import { frontendSkill } from "./frontend.js";
import { backendSkill } from "./backend.js";
import { securitySkill } from "./security.js";
import { refactorSkill } from "./refactor.js";

export const skillRegistry = {
  frontend: frontendSkill,
  backend: backendSkill,
  security: securitySkill,
  refactor: refactorSkill,
};

// Deteksi skill dari input user
export function detectSkills(userInput) {
  const input = userInput.toLowerCase();
  const skills = [];

  for (const [name, skill] of Object.entries(skillRegistry)) {
    for (const trigger of skill.triggers) {
      if (input.includes(trigger)) {
        skills.push(skill);
        break;
      }
    }
  }
  return skills;
}

// Dapatkan prompt system dari skill yang aktif
export function getSkillPrompt(skills) {
  if (!skills.length) return "";
  return skills.map(s => s.prompt).join("\n\n");
}
