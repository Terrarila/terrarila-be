// Run after a successful manual backup. Installs only this project's daily user LaunchAgent.
import { mkdir,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
if(process.platform!=='darwin')throw new Error('Use the systemd example on Linux');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const label='com.petitetterre.localbackup';
const directory=join(root,'backups');await mkdir(directory,{recursive:true,mode:0o700});
const target=join(homedir(),'Library','LaunchAgents',`${label}.plist`);
const args=[process.execPath,'--import','tsx','--env-file-if-exists=.env',join(root,'scripts','operations','local-backup.ts')];
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(value=>`<string>${xml(value)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(process.execPath))}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>${xml(join(directory,'daily-backup.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(directory,'daily-backup-error.log'))}</string>
</dict></plist>`;
await mkdir(dirname(target),{recursive:true});await writeFile(target,plist,{mode:0o600});
execFileSync('/usr/bin/plutil',['-lint',target],{stdio:'inherit'});
const domain=`gui/${process.getuid()}`;
try{execFileSync('/bin/launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'});}catch{}
execFileSync('/bin/launchctl',['bootstrap',domain,target],{stdio:'inherit'});
console.log(`Installed daily 02:30 local-time backup: ${target}`);
