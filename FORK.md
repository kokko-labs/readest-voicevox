# About This Fork

This repository is an unofficial fork of
[readest/readest](https://github.com/readest/readest). It adds optional desktop
integration with a separately installed VOICEVOX Engine for local
text-to-speech playback.

It is not affiliated with or endorsed by Readest, Bilingify LLC, VOICEVOX, or
any VOICEVOX character or voice-library rights holder.

## Changes from Upstream

Compared with upstream Readest, this fork:

- connects to a local VOICEVOX Engine at `http://127.0.0.1:50021`;
- lists its talk speakers and styles in the voice picker; and
- uses the Engine for text-to-speech playback in desktop builds.

Web and mobile builds retain the upstream text-to-speech behavior.

## VOICEVOX Setup

Install and start VOICEVOX from the
[official website](https://voicevox.hiroshiba.jp/), then launch the desktop
build of this fork. The integration expects the Engine at its default address,
`127.0.0.1:50021`.

VOICEVOX and its voice models are not included in or installed by this
repository.

## Licensing and Attribution

Readest and this fork's modifications are distributed under the
[GNU Affero General Public License](LICENSE). VOICEVOX, its voice models,
characters, and generated audio remain subject to their respective terms.

Before using or publishing generated audio, review:

- [VOICEVOX Terms of Use](https://voicevox.hiroshiba.jp/term/)
- [VOICEVOX licensing Q&A](https://voicevox.hiroshiba.jp/qa/)
- [VOICEVOX voice-model and voice-library terms](https://github.com/VOICEVOX/voicevox_vvm/blob/main/TERMS.txt)

Credit wording and usage conditions vary by speaker and intended use. This fork
does not add credits automatically; users are responsible for following the
applicable terms and obtaining any required permission.

This summary does not replace the applicable terms or legal advice.

## Support

Report VOICEVOX integration issues to this fork. For the original project,
visit [readest/readest](https://github.com/readest/readest). The upstream
Readest project and VOICEVOX rights holders do not support this fork.
