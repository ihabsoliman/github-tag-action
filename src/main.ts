import * as core from '@actions/core';
import action from './action.js';

async function run() {
  try {
    await action();
  } catch (error: any) {
    const softFail = /true/i.test(core.getInput('soft_fail'));
    if (softFail) {
      core.warning(
        `Push version tag failed but soft_fail is enabled, continuing without tagging: ${error.message}. ` +
          "Check the 'tag_created' output before relying on any other output (new_tag, new_version, etc.) - " +
          'no tag was actually pushed for this run.',
      );
      return;
    }
    core.setFailed(error.message);
  }
}

run();
