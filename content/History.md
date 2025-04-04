# Contrast-Resolution Test Target and Evaluation Methods
## Historical Overview

_Franz Sigg_

The ConRes test target came out of a discussion Franz Sigg had with Dr. Ed. Granger at a lunch table at RIT in the fall of 1999 related to the thesis topic for Eliot Harper, who was working on his Masters at the time. This discussion led to first attempts to making what eventually becomes the Contrast-Resolution test target that is familiar to many today, and for which earliest research uses date back the completed thesis work of Eliot Harper (2000) title "An Investigation Into the Relationship Between Contrast and Resolution of a Printing System Using the RIT Contrast Resolution Test Target" and his winning entry of the 2001 Technical Association of the Graphic Arts graduate research paper of the same title.

This was only the start of many extensive research endeavors, involving additional RIT student work, including Deepak Dubay's (2003) RIT student TAGA paper on the "Relationship between Contrast Resolution Volume (CRV) and Modulation Transfer Function (MTF)" leading to his thesis (2005) on "A Comparative Analysis between the RIT Contrast Resolution Test Target And the Gutenberg Test Target".

In 2006 Franz Sigg wrote a paper for the RIT TestTargets 6 publication with the title "Testing for Resolution and Contrast" The topic was also taught to students at RIT.

To date, there are some 29 implementations of the target, all hand programmed in PostScript by Franz Sigg to elicit pixel perfect vector-based detail and tone that have made it possible to measure the limitations and correlation extents of those aspects in print and other imaging domains, where otherwise they would have remained inconceivable or untenable to even explore.

Version 1 shown in Figure 1 used a continuously varying checkerboard pattern to test ConRes.

<figure>
<img width=100% src="./assets/aConRes1.png" background-color:=#FFF />
<figcaption align=center>Figure 1 — ConRes Target Version 1 — created April 2000</figcaption>
</figure>

Checkerboards created interference patterns with the addressability grid, and therefore it was decided to use parallel lines for version 5 (Figure 2).

<figure>
<img width=100% src="./assets/aConRes5.png" background-color:=#FFF />
<figcaption align=center>Figure 2 — ConRes Target Version 5 — created June 2000</figcaption>
</figure>

Two color overprints are also affected by the accuracy of registration. Since we want to test for Resolution at various Contrasts, the multicolor blocks are not needed in the target. Furthermore, yellow is difficult to see, and therefore is left out of version 8 of the target (Figure 3).

<figure>
<img width=100% src="./assets/aConRes8F.png" background-color:=#FFF />
<figcaption align=center>Figure 3 — ConRes Target Version 8 — created November 2000</figcaption>
</figure>

By adding a visual reference tone value area near each patch, making the blocks rectangular, more efficient use of space can be made and there is room for documentation of the numeric values of the patches (Figure 4).

<figure>
<img width=100% src="./assets/aCONRE13U.png" background-color:=#FFF />
<figcaption align=center>Figure 4 — ConRes Target Version 9 — created December 2000</figcaption>
</figure>

May be gradients provide an additional visual evaluation of tone reproduction? (Figure 5).

<figure>
<img width=100% src="./assets/cCONRES9U.png" background-color:=#FFF />
<figcaption align=center>Figure 5 — ConRes Target Version 13 — created April 2002</figcaption>
</figure>

Figure 6 shows one way to report the results of an evaluation. The area under each curve is a measure of Contrast-Resolution performance and can be used as a figure of merit called CR index.

<figure>
<img width=100% src="./assets/aEliot_Harper_Thesis_3D.png" background-color:=#FFF />
<figcaption align=center>Figure 6 — Excel Spreadsheet for Evaluation —of ConRes target, updated May 2002 with TAGA data.</figcaption>
</figure>

Since there are three variables, the data can be shown as a 3D graph (Figure 7), and the figure of merit can be called Contrast Resolution Volume (CRV).

<figure>
<img width=100% src="./assets/Conres24_TAGA.graphs.png" background-color:=#FFF />
<figcaption align=center>Figure 7 — 3D graphs in Excel —Spreadsheet for Evaluation of ConRes target, updated May 2002</figcaption>
</figure>

The print engine for black is the same as the ones for color, therefore Figure 8 shows that it is really enough to only test the black channel of an output device, making the target even smaller.

<figure>
<img width=100% src="./assets/cCONRE14U.png" background-color:=#FFF />
<figcaption align=center>Figure 8 — ConRes Target Version 14 — created July 2002</figcaption>
</figure>

A big innovation occurred when it was realized that circles are a much better way to test for ConRes capability. By simply answering the question whether the circles of a given patch are recognizable or not, a simply yes or no answer evaluates perceptional quality in all directions. The first circular version was number 16. Figure 9 shows version 18.

<figure>
<img width=100% src="./assets/cConRe18F.png" background-color:=#FFF />
<figcaption align=center>Figure 9 — ConRes Target Version 18 — created Apr 2000</figcaption>
</figure>

The target has the capability to be adjusted by different parameters that can be set in the header of the original EPS file. Some of the settable items are: number of resolution and contrast steps, color, size of patches, range of resolution and contrast. These last two are normally set to the perceptible range of the visual system at reading distance. Figure 10 shows one of the possible configurations.

It is also possible to adjust the average tone value of the target. So far, the targets that were shown have a 50% tone value. By adjusting the tone value of the dark and light circles of a patch, different average tone values can be obtained. This way the ConRes performance at different tone value levels can be tested. See version 28 of the target at the end of this paper in Figures 12 and 13.

<figure>
<img width=100% src="./assets/cCirRe22F.png" background-color:=#FFF />
<figcaption align=center>Figure 10 — ConRes Target Version 22 — created October 2007</figcaption>
</figure>

Since the circular pattern is symmetrical around its center, it is possible to split the circles in half and still sample all angular directions. Each half of a circular patch can then have a slightly different treatment. In the following example of Figure 11, one half is Black only, while the other halve is CMY and therefore also subject to misregistration.

<figure>
<img width=100% src="./assets/cCIRRe221U.png" background-color:=#FFF />
<figcaption align=center>Figure 11 — Split patches setting for —section of ConRes Target Version 22</figcaption>
</figure>

It is also possible to have a slight tone value difference between the two halves. This permits to show the loss of ConRes performance when there are only a limited number of gray levels available from the output device. Gray levels can be limited on systems that can only image either full colorant or no colorant (such as Offset or Indigo which are binary or have a bit depth of only 1). If on such a system the addressability is low (less than 1200 spi) and the screen ruling is relatively fine (more than 150 lpi) then the number of gray levels is less than 64. In such a system, a smooth gradient is shown as a step wedge. If the tone value of the foreground and background of the circles happen to fall on the same tone value step, no circles will be shown, indicating a loss of resolution. This is not a serious problem for printing systems, most systems have enough gray levels for average images, but this target can be one way to test for it.

It is also possible to adjust the average tone value of the target since version 9. So far, the targets that were shown have a 50% tone value. By adjusting the tone value of the dark and light circles of a patch, different average tone values can be obtained. This way the ConRes performance at different tone value levels can be tested. Each tone value level is imaged with its own block. Depending how many tone value blocks are desired, there may be left over space for an odd number of blocks. In such a case it is possible to activate other targets such as a screen ruling indicator or and addressability indicator. Although all these targets look different, they are all generated with the same EPS code, the only thing that is different are the parameter settings, in the header of the EPS file.

Beginning in 2007, targets were used in test pages made for ISO/IEC JTC-1 SC28 WG4. Eric Zeise from Kodak, developed a Matlab program that facilitated visual evaluation of the target and was used for ISO. Saleh Motaal wrote another analysis software that eventually should automatically analyze an image created by scanning a print from the ConRes test target. The data input modules are done, but the automatic analysis was not completed.

<figure>
<img width=100% src="./assets/cCIRRE28U.png" background-color:=#FFF />
<figcaption align=center>Figure 12 — ConRes Target Version 28 — created February 2008</figcaption>
</figure>

<figure>
<img width=100% src="./assets/CirRe33_2_pages-s.jpg" background-color:=#FFF />
<figcaption align=center>Figure 13 — High sampling, two —page layout</figcaption>
</figure>

Small step increments for the three variables of Contrast Resolution and ToneValue. Capability to linearize tone reproduction in EPS file.

Figure 14 shows a possible version of high resolution ConRes Gamut graphs. Figure 15 shows how different gamuts can be compared. CRI is the ConRes Index which is measured by the volume underneath the gamut surface.

<figure>
<img width=100% src="./assets/NP_Gloss-600_Graphs.png" background-color:=#FFF />
<figcaption align=center>Figure 14 — ConRes Gamut plots for —both Good and Just Acceptable resolution</figcaption>
</figure>

<figure>
<img width=100% src="./assets/NP_Gloss-600_-_Uncoated_Graphs.png" background-color:=#FFF />
<figcaption align=center>Figure 15 — ConRes Gamut comparison for —coated and uncoated paper</figcaption>
</figure>

<figure float:= left max-width:=50%>
</figcaption>
<figcaption align=center>Figure 16 — Version released for ISO —testing on 20/12/2012.
<img width=100% src="./assets/ConRes281PDi.png" />
</figure>

---

The version shown in figure 16 has been released for testing by ISO WG4 and JWG 14.

In addition, the target is also used in tests conducted to see how much JPEG can be used and still get good quality for archiving documents for the Library of Congress.

<figure clear:=both>
<img width=100% src="./assets/ConRes283_Uni_Stuttgart_F.png" background-color:=#FFF />
<figcaption align=center>Figure 17 — A very compact version —/figcaption>
</figure>

Figure 17 shows a very compact version that was used in a gravure testing investigation at the Hochschule der Medien in Stuttgart, 2013. There was only a stripe of 35mm available. Columns are offset at lower contrast to reduce the number of required patches. Therefore separate labels are required for each patch.

Various companies (Kodak, Xerox, Fogra) have made preliminary tests with the target. Because the target has become so large, it is very tedious to evaluate it. Even with the computer assisted visual evaluation programs from Eric Zeise and Saleh Motaal it took a long time to evaluate a target.

A large scale perceptual evaluation of the ConRes target was needed, but was not yet done. ISO did a round robin test where the `8_Conres_Native_Addressability_SepK_600.pdf` test page was printed by several organizations internationally.

In June 2013, at the ISO/IEC JTC1/SC28 WG4 Vienna Meeting, Thomas Liensberger presented his Matlab program called L‑Score that he had developed under the guidance of Fogra, that did an automated evaluation of ConRes.

On November 14, 2014, at the ISO TC130 JWG14 Beijing meeting, Miho Uno and Shinji Sasahara from Fuji Xerox, presented their research using an improvement over the L‑Score algorithm.

In August 2018, Frans Gaykema from Océ-Technologies B.V. made an EXE file available to ISO that automatically analyzes a scan of ISO_ConRes19 or ConRe281.

Since January 2014 Eric Zeise was writing a new ISO standard about the ConRes Target:

ISO_DTS_18621-31, Graphic technology — Measurement of visual attributes of printed materials —Part 31: L-Score method for perceived resolution evaluation utilizing a contrast resolution target.

Eventually, the L-Score method was not used and replaced with improved code. Eric Zeise wrote his own analysis Matlab program in order to understand exactly what was required. The ISO work has progressed to the "Preliminary Draft Technical Specification" stage with the name ISO/PDTS 18621-31.42 (Nov. 29, 2018). The standard does not contain the Matlab code, only a flowchart of how a program could be structured to do an analysis. Eric Zeise has done an outstanding job in writing the standard. It was a lot of work.

In addition to the analysis routine it was also necessary to specify scanner conformance requirements; printer setup and linearization and data path requirements; reporting of results.

Part of the research that Eric conducted showed that the fiducial marks of the existing targets were difficult to unambiguously automatically detect, and therefore a new version named `ISO_ConRes19g.PDF` was created as shown in Figure 18. The reference tint around each patch is now symmetrically distributed, with the fiducial marks in the frame and no longer touching the patches. Also, a step wedge was added to allow verification of "linear" tone reproduction. The gray background also helps to reduce edge effects due to internal reflections in the paper substrate.

<figure>
<img width=100% src="./assets/ISO_ConRes19g.png" background-color:=#FFF />
<figcaption align=center>Figure 18 — Proposed version for ISO_DTS_18621 —31</figcaption>
</figure>

Dec. 6, 2018: Eric Zeise, Saleh Motaal and Franz Sigg regularly meet each week by Skype and try to make an automated analysis system that can analyze the large, unpublished targets (similar to Figure 13).

Saleh attempts to use JavaScript and HTML instead of Matlab, because possible internet based analysis services could use a Webbrouser as application software. He already wrote an implementation of a Fast Fourier Transformation module in JavaScript, and he found a better way to use modules in JavaScript. He is now attempting to write a JavaScript module that would do the linearization function. We are discussing on how to implement a perceptual ConRes study which would allow to asses the quality of automated analysis functions.

A lot more work to be done.
