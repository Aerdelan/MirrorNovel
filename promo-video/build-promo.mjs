import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const dir = path.join(root, 'promo-video');
const audioDir = path.join(dir, 'audio');
const scenesDir = path.join(dir, 'scenes');
const out = path.join(dir, 'MirrorNovel_promo.mp4');
const scenes = [
  ['00-generate.png', 'seg_1.mp3'],
  ['01-selected.png', 'seg_2.mp3'],
  ['03-bookshelf.png', 'seg_3.mp3'],
  ['04-models.png', 'seg_4.mp3'],
  ['05-polish.png', 'seg_5.mp3'],
  ['00-generate.png', 'seg_6.mp3'],
];

fs.mkdirSync(scenesDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${command} failed with code ${result.status}`);
  }
  return result.stdout.trim();
}

function duration(file) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]));
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
}

const lines = fs.readFileSync(path.join(dir, 'narration.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
let elapsed = 0;
const captions = [];
const sceneFiles = [];

for (let i = 0; i < scenes.length; i += 1) {
  const [frame, audio] = scenes[i];
  const image = path.join(dir, 'frames', frame);
  const voice = path.join(audioDir, audio);
  const seconds = duration(voice);
  const scenePath = path.join(scenesDir, `scene_${i + 1}.mp4`);
  const fadeOut = Math.max(0.2, seconds - 0.35).toFixed(3);
  run('ffmpeg', [
    '-y', '-loop', '1', '-i', image, '-i', voice, '-t', seconds.toFixed(3),
    '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.35`,
    '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k', '-shortest', scenePath,
  ]);
  sceneFiles.push(scenePath);
  captions.push(`${i + 1}\n${srtTime(elapsed)} --> ${srtTime(elapsed + seconds)}\n${lines[i]}\n`);
  elapsed += seconds;
}

const srt = path.join(dir, 'captions.srt');
fs.writeFileSync(srt, captions.join('\n'), 'utf8');
const concat = path.join(dir, 'concat.txt');
fs.writeFileSync(concat, sceneFiles.map((file) => `file '${file.replaceAll('\\', '/')}'`).join('\n'), 'utf8');
const montage = path.join(dir, 'montage.mp4');
run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', montage]);
run('ffmpeg', ['-y', '-i', montage, '-vn', '-c:a', 'pcm_s16le', path.join(dir, 'narration.wav')]);

const music = path.join(dir, 'music.wav');
run('ffmpeg', [
  '-y', '-f', 'lavfi', '-i', `aevalsrc=0.025*(sin(2*PI*220*t)+0.55*sin(2*PI*277.18*t)+0.35*sin(2*PI*329.63*t)+0.18*sin(2*PI*440*t)):s=48000:d=${(elapsed + 0.2).toFixed(3)}`,
  '-af', `lowpass=f=1400,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, elapsed - 3).toFixed(3)}:d=3`,
  '-c:a', 'pcm_s16le', music,
]);

run('ffmpeg', [
  '-y', '-i', montage, '-i', music,
  '-filter_complex', '[0:a]volume=1.0[voice];[1:a]volume=0.22[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]',
  '-map', '0:v:0', '-map', '[aout]',
  '-vf', "subtitles=promo-video/captions.srt:force_style='FontName=Microsoft YaHei\\,FontSize=16\\,PrimaryColour=&H00FFFFFF\\,OutlineColour=&H0020352A\\,BorderStyle=1\\,Outline=1\\,Shadow=1\\,MarginV=34\\,Alignment=2'",
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
]);

console.log(JSON.stringify({ output: out, duration: elapsed, captions: srt }, null, 2));
