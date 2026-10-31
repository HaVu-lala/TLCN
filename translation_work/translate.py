from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import re

src=next(Path('D:/Downloads').glob('*07*KHLT*.docx'))
out=Path('D:/Tai lieu/ki6/TLCN/M-RACE_2026_English.docx')
translations={
0:'YOUTH UNION - STUDENTS’ ASSOCIATION',
1:'HO CHI MINH UNIVERSITY',
2:'OF BANKING',
3:'YOUTH UNION - STUDENTS’ ASSOCIATION\nFACULTY OF MANAGEMENT INFORMATION SYSTEMS',
5:'No.: 07-KHLT/ĐK-LCH',
6:'SOCIALIST REPUBLIC OF VIET NAM',
7:'Independence - Freedom - Happiness',
11:'Ho Chi Minh City, day     month     2026',
12:'PLAN',
13:'Organization of the “M-RACE” 2026 Cross-Country Run',
14:'I. OBJECTIVES - REQUIREMENTS:',
15:'1.1. Objectives:',
16:'- Raise students’ awareness of the importance of sports and physical activity for health;',
17:'- Provide a healthy, safe and practical setting for students to improve their physical fitness after classes;',
18:'- Encourage exercise and sports to improve the health of students at Ho Chi Minh University of Banking;',
19:'- Help students meet the “Good Physical Fitness” criterion for the “Student of Five Merits” title;',
20:'- Support the “10,000 Steps a Day for Every Young Person” campaign.',
21:'1.2. Requirements:',
22:'- Strengthen publicity, encourage student participation and promote physical fitness through running;',
23:'- Organize the event responsibly, economically, on schedule and effectively, meeting its objectives, ensuring smooth implementation and keeping participating students safe;',
24:'- Assess and certify “Physically Fit Students” honestly and accurately based on supporting evidence.',
25:'II. TIME - VENUE - PARTICIPANTS - PARTICIPANT NUMBERS:',
26:'2.1. Event time: 7:15 a.m. on 13 December 2026',
27:'2.2. Venue: Running route within the campus of Ho Chi Minh University of Banking.',
28:'2.3. Participants: All students of Ho Chi Minh University of Banking.',
29:'III. PROGRAM DETAILS:',
30:'3.1. Competition format: Individual competition in two divisions: Men and Women.',
31:'3.2. Registration:',
32:'- Students register online via the “Faculty of Management Information Systems - Ho Chi Minh University of Banking - HUB” Facebook page using the Google Forms link provided by the Organizing Committee.',
33:'- Registration period: 8:00 p.m. on 6 December 2026 to 8:00 p.m. on 11 December 2026',
34:'3.3. Route and race distance: (See attached appendix)',
35:'3.4. Participant benefits:',
36:'- All participating students receive points toward Youth Union member classification.',
37:'- The 12 top-performing students receive cash prizes from the Organizing Committee.',
38:'- “Physically Fit Student” certificates are awarded to students who run at the scheduled time, complete the full prescribed distance and route, and meet the Organizing Committee’s requirements.',
39:'IV. PRIZES:',
40:'- 02 First Prizes: VND 300,000 in cash + certificate each (01 for the Men’s division and 01 for the Women’s division).',
41:'- 02 Second Prizes: VND 200,000 in cash + certificate each (01 for the Men’s division and 01 for the Women’s division).',
42:'- 02 Third Prizes: VND 100,000 in cash + certificate each (01 for the Men’s division and 01 for the Women’s division).',
43:'- 6 Consolation Prizes: VND 50,000 in cash + certificate each (03 for the Men’s division and 03 for the Women’s division).',
44:'V. IMPLEMENTATION SCHEDULE:',
45:'Time',46:'Task',
48:'Prepare the plan and seek feedback from the Faculty Party Committee, University Youth Union Standing Committee and University Students’ Association Secretariat.',
50:'Launch the Cross-Country Run.',52:'Hold the Cross-Country Run.',54:'Hold a post-event review meeting.',
55:'VI. REQUESTED SUPPORT AND FACILITIES:',
56:'No.',57:'Request',58:'Details',60:'Youth Union member classification points',61:'Yes',
63:'Publicity on the “Banking Students of Five Merits” Facebook page',64:'Yes',
66:'Issue digital “Physically Fit Student” certificates through the University Students’ Association and request the selection council for the “Student of Five Merits at All Levels, 2025 - 2026” title to consider recognition under the “Good Physical Fitness” criterion.',
67:'Yes (for participating students and the Organizing Committee)',
69:'Medical office support for students who experience health problems during the Cross-Country Run.',
70:'Yes (support requested on 13/12/2026)',72:'Use of the university campus',73:'13/12/2026',
74:'VII. ESTIMATED BUDGET:',75:'No.',76:'Item',77:'Unit price (VND)',78:'Quantity',79:'Unit',80:'Amount (VND)',81:'Notes',
83:'First Prize (cash)',86:'Prize',88:'1 prize per division',90:'Second Prize ',91:'(cash)',94:'Prize',96:'1 prize per division',98:'Third Prize ',99:'(cash)',102:'Prize',104:'1 prize per division',106:'Consolation Prize (cash)',109:'Prize',111:'3 prizes per division',113:'Small water bottles',116:'Bottle',120:'Standee',123:'Piece',127:'Envelopes',130:'Piece',134:'Ribbon',141:'Confectionery',148:'Water container',155:'Finish-line marking tape and marshal flags',162:'Allowance for medical staff',169:'Printing',175:'Other expenses',178:'TOTAL:',
181:'* Allocation of funding sources:',182:'No.',183:'Source',184:'Amount (VND)',
186:'Faculty of Management Information Systems Youth Union Fund',
189:'Faculty of Management Information Systems Students’ Association Fund',
191:'VIII. IMPLEMENTATION ARRANGEMENTS:',192:'8.1. Steering Committee:',
193:'- Trần Thiên Kỷ, Master’s degree holder - Secretary of the University Youth Union;',
194:'- Phan Đức Mạnh - President of the University Students’ Association;',
195:'- Huỳnh Phương Uyên - Vice President of the University Students’ Association;',
196:'- Dr. Trịnh Hoàng Nam - Vice Dean, in charge of the Faculty of Management Information Systems;',
197:'- Hồ Thị Thanh Nhàn - Secretary of the Faculty of Management Information Systems Youth Union;',
198:'- Hoàng Thị Yến Nhi - President of the Faculty of Management Information Systems Students’ Association.',
199:'8.2. Organizing Committee:',
200:'- Trần Ngô Mỹ Dung - Executive Committee member of the Faculty Youth Union - Head of the Organizing Committee;',
201:'- Nguyễn Thị Quỳnh - Executive Committee member of the Faculty Students’ Association - Deputy Head of the Organizing Committee;',
202:'- Phan Nguyễn Đức Lộc - Executive Committee member of the Faculty Students’ Association - Deputy Head of the Organizing Committee;',
203:'- Other Executive Committee members and collaborators of the Faculty of Management Information Systems Youth Union and Students’ Association - Organizing Committee members.',
204:'8.3. Main contact:',205:'- Full name: Trần Ngô Mỹ Dung',206:'- Class: DH41HT03',
207:'- Position: Executive Committee member, Faculty Youth Union',208:'- Telephone: 0906812280',209:'- Email: dwinn0027@gmail.com',
211:'FOR THE FACULTY STUDENTS’ ASSOCIATION\nEXECUTIVE COMMITTEE',212:'PRESIDENT',214:'(signed)',
217:'FOR THE FACULTY YOUTH UNION\nEXECUTIVE COMMITTEE',218:'SECRETARY',220:'(signed)',
224:'COMMENTS OF THE FACULTY PARTY COMMITTEE AND DEAN’S BOARD',
229:'FOR THE UNIVERSITY STUDENTS’\nASSOCIATION SECRETARIAT',230:'PRESIDENT',
235:'FOR THE UNIVERSITY YOUTH UNION\nSTANDING COMMITTEE',236:'SECRETARY',
244:'Recipients:',245:'- University Youth Union Standing Committee (for feedback);',
246:'- University Students’ Association Secretariat (for feedback);',
247:'- Faculty Party Committee and Dean’s Board (for feedback);',
248:'- Faculty Youth Union and Students’ Association (for implementation);',249:'- Filed at the unit.'
}
translations.update({77:'Unit cost (VND)',78:'Qty',88:'1 per division',96:'1 per division',104:'1 per division',111:'3 per division',113:'Small water bottles',148:'Water jug',155:'Finish-line tape, marshal flags',162:'Medical staff allowance'})
translations.update({193:'- Trần Thiên Kỷ (Master’s degree) - Secretary of the University Youth Union;',196:'- Dr. Trịnh Hoàng Nam - Vice Dean in charge, MIS Faculty;',197:'- Hồ Thị Thanh Nhàn - Secretary of the MIS Faculty Youth Union;',198:'- Hoàng Thị Yến Nhi - President of the MIS Faculty Students’ Association.',203:'- Other Executive Committee members and collaborators of the MIS Faculty Youth Union and Students’ Association - Organizing Committee members.',211:'FOR THE FACULTY STUDENTS’ ASSOCIATION EXEC. COMMITTEE',217:'FOR THE FACULTY YOUTH UNION EXEC. COMMITTEE',224:'FACULTY PARTY COMMITTEE AND DEAN’S BOARD COMMENTS',229:'FOR THE UNIVERSITY STUDENTS’ ASSOCIATION SECRETARIAT',235:'FOR THE UNIVERSITY YOUTH UNION STANDING COMMITTEE'})
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W='{'+n['w']+'}'
with ZipFile(src) as zin:
 root=etree.fromstring(zin.read('word/document.xml'))
 paras=root.xpath('//w:p',namespaces=n)
 for i,text in translations.items():
  p=paras[i]; nodes=p.xpath('.//w:t',namespaces=n)
  if not nodes: raise ValueError(i)
  # Keep every original paragraph, run and property; change text nodes only.
  # Run boundaries are preserved at word boundaries, with the original relative lengths.
  old=[len(t.text or '') for t in nodes]; total=sum(old)
  consumed=0; pos=0
  for j,t in enumerate(nodes):
   consumed+=old[j]
   if j==len(nodes)-1: end=len(text)
   else:
    target=round(len(text)*consumed/total)
    choices=[m.end() for m in re.finditer(r'\s+',text) if m.end()>=pos]
    end=min(choices,key=lambda x:abs(x-target)) if choices else pos
    end=max(pos,end)
   t.text=text[pos:end];t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');pos=end
  # Explicit English proofing language on translated runs.
  for r in p.findall('w:r',n):
   pr=r.find('w:rPr',n)
   if pr is None: pr=etree.SubElement(r,W+'rPr');r.remove(pr);r.insert(0,pr)
   lang=pr.find('w:lang',n)
   if lang is None: lang=etree.SubElement(pr,W+'lang')
   lang.set(W+'val','en-US')
 with ZipFile(out,'w') as zout:
  for item in zin.infolist():
   data=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True) if item.filename=='word/document.xml' else zin.read(item.filename)
   zout.writestr(item,data)
print(out)
print('Translated paragraphs:',len(translations))
