import * as core from '@actions/core';
import action from './action';

async function run() {
  try {
    await action();
  } catch (error: any) {
    const softFail = /true/i.test(core.getInput('soft_fail'));
    if (softFail) {
      core.warning(
        `Push version tag failed but soft_fail is enabled, continuing without tagging: ${error.message}`
      );
      return;
    }
    core.setFailed(error.message);
  }
}

run();
