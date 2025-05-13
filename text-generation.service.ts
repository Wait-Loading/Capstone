/* eslint-disable @stylistic/quotes */
/* eslint-disable @stylistic/lines-between-class-members */
/* eslint-disable @stylistic/indent */
import { Injectable } from '@angular/core';
import { BedrockRuntime } from '@aws-sdk/client-bedrock-runtime';
import { filter, firstValueFrom, map, switchMap } from 'rxjs';
import { distinctUntilChanged, tap } from 'rxjs/operators';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { AccessTokenServiceProvider, BillingPaymentStatus } from '@tasktrain/shared';
import { environment } from '@environment/browser';
import { OrganizationReadService } from '../gql-operations/organization/organization-read.service';
import { ViewStateParametersReadService } from '../gql-operations/_client/view-state-parameters-read.service';
import { ViewStateParameters } from './view-state/view-state-parameters.model';
import { AccessTokenReadService } from '../gql-operations/utility/access-token-read.service';
import { MessageService, UserNotificationMessage, UserNotificationType } from './message-service';

export enum TextGenerationType {
  Rephrase = 'Rephrase',
  Translate = 'Translate',
  Elaborate = 'Elaborate',
  Summarize = 'Summarize',
  Ask = 'Ask',
  Generate = 'Generate',
}

export enum TranslateLanguageSubType {
  Arabic = 'Arabic',
  Chinese = 'Chinese (Mandarin)',
  English = 'English',
  French = 'French',
  German = 'German',
  Hindi = 'Hindi',
  Italian = 'Italian',
  Russian = 'Russian',
  Spanish = 'Spanish',
  Turkish = 'Turkish',
}

@UntilDestroy()
@Injectable({
  providedIn: 'root',
})
export class TextGenerationService {
  public isTextGenerationEnabled: boolean;
  private bedrockClient: BedrockRuntime;

  // Add these missing properties
  public static  userResponses: Record<string, string> = {};
  private currentQuestionIndex: number = 0;
	private followUpQuestions: string[] = []; // Define followUpQuestions here
	public static isprocedure = false;
	public static isprocedure_2 = false;
	public edit = false;

  constructor(
    private organizationReadService: OrganizationReadService,
    private viewStateParametersReadService: ViewStateParametersReadService,
    private accessTokenReadService: AccessTokenReadService,
    private messageService: MessageService,
  ) {
    this.monitorOrganizationBillingStatus();
  }

  /** Monitor and update text generation availability */
  private monitorOrganizationBillingStatus(): void {
    this.viewStateParametersReadService.mappedWatch().pipe(
      map((viewStateParameters: ViewStateParameters) => viewStateParameters.organizationId),
      filter(Boolean),
      switchMap((organizationId: string) => this.organizationReadService.fetch({ organizationId })),
      untilDestroyed(this),
    ).subscribe(({ data: { OrganizationRead } }) => {
      this.isTextGenerationEnabled =
        OrganizationRead.billingInfo.plan.unitPrice !== 0 &&
        OrganizationRead.billingInfo.paymentStatus !== BillingPaymentStatus.Failed;
    });
  }

  /** Initializes AWS Bedrock client if needed */
  private async initializeBedrockClient(): Promise<void> {
    if (!this.bedrockClient) {
      await firstValueFrom(
        this.viewStateParametersReadService.mappedWatch().pipe(
          map((viewStateParameters: ViewStateParameters) => viewStateParameters.accountId),
          filter(Boolean),
          distinctUntilChanged(),
          switchMap((accountId) =>
            this.accessTokenReadService.fetchDecryptedToken({
              accountId,
              serviceProvider: AccessTokenServiceProvider.AWSBedrock,
            })
          ),
          tap((accessTokenResponse) => {
            this.bedrockClient = new BedrockRuntime({
              credentials: {
                accessKeyId: accessTokenResponse.key,
                secretAccessKey: accessTokenResponse.secret,
              },
              region: environment.AWS_BEDROCK_REGION,
            });
          }),
        ),
      );
    }
  }

  /** General-purpose generator for text types */
  public generateText = async (
    type: Exclude<TextGenerationType, TextGenerationType.Ask>,
    payload: string,
    subtype?: string
  ): Promise<string> => {
    if (!this.isTextGenerationEnabled) return '';

    await this.initializeBedrockClient();
    const request = this.buildRequest(type, payload, subtype);
    return this.invokeModelWithRequest(request);
  };

  /** Dedicated method for "Ask" */
  public ask = async (question: string): Promise<string> => {
    if (!this.isTextGenerationEnabled) return '';

    await this.initializeBedrockClient();
    return this.invokeModelWithRequest(question);
  };

	public async generateProcedure2(userInput?: string): Promise<string> {
		TextGenerationService.isprocedure =false;
    if (!this.isTextGenerationEnabled) return '';

		if(this.edit===true) {
			TextGenerationService.isprocedure = true;
			TextGenerationService.userResponses['procedureEditDescription'] = userInput;
			this.edit = false;
				return this.generateFinalProcedure();

		}

    if (!TextGenerationService.userResponses && this.edit===false
		) {
      TextGenerationService.userResponses = {};
      this.currentQuestionIndex = 0;
      this.followUpQuestions = []; // Initialize followUpQuestions
    }

    if (userInput) {
      // Store user's response
      const question = `Procedure Description: ${userInput}`;
      TextGenerationService.userResponses[question] = userInput;
      this.currentQuestionIndex++;
    }

    // If follow-up questions haven't been generated yet, generate them now
    if (this.currentQuestionIndex === 1 && this.followUpQuestions.length === 0) {
      this.followUpQuestions = await this.generateFollowUpQuestions();
      this.currentQuestionIndex = 0; // Reset index to ask follow-up questions
    }

    // If all questions are answered, generate the final procedure
    if (this.currentQuestionIndex >= this.followUpQuestions.length) {
			TextGenerationService.isprocedure = true;
			if (!TextGenerationService.isprocedure_2) {
				this.edit = false;
				return this.generateFinalProcedure();

			} else {
				return this.generateFinalProcedure_2();
			}

    }

    // Ask the next follow-up question
		if(this.edit===false) {
    return this.followUpQuestions[this.currentQuestionIndex];}
		else{
			this.edit = false;
			return this.generateFinalProcedure();		}
  }


	/** Edits an AI-generated message based on a prompt */
public async editGeneratedText(originalText: string, editInstruction: string): Promise<string> {
  if (!this.isTextGenerationEnabled) return '';

  await this.initializeBedrockClient();

  const request = `
You are an expert editor. The following text was generated by an AI system:

"${originalText}"

Your task is to modify this text based on the following instruction:
"${editInstruction}"

Make the requested changes while preserving the overall structure, clarity, and formatting of the original content. Return only the updated version.
`;

  return this.invokeModelWithRequest(request);
}


  private async generateFollowUpQuestions(): Promise<string[]> {
    await this.initializeBedrockClient();

    const request = `
    The user has provided the following description about a procedure:
    ${JSON.stringify(TextGenerationService.userResponses)}

    Based on this, generate 5-6 follow-up questions that will help refine and improve the procedure remember that we are making a SOP (Standard Operating Procedure ).
    The questions should be specific and relevant to the details given.
    Return them as a numbered list.
    `;

    const response = await this.invokeModelWithRequest(request);
    return response.split("\n").map(q => q.replace(/^\d+\.\s*/, "").trim()).filter(q => q.length > 0);
  }

  private async generateFinalProcedure(): Promise<string> {
    await this.initializeBedrockClient();

    const request = `
    Here is the collected information for the procedure:
    ${JSON.stringify(TextGenerationService.userResponses)}

    Using this information, generate a well-structured procedure.
    Use Heading 1-4 styles, numbered/bulleted lists for steps, and maintain a professional tone.
    Ensure clarity, conciseness, and completeness. Do not use numbers , just use indentions and bullet points, also make sure you directly start from a heading. answer in html syntax, do not give any overview , we want an SOP directly.
		DO NOT GIVE AN OVERVIEW., /<(h[1-6]|ol|ul)\b[^>]*>/i; This is the valid REGEX , your responce should pass this valitation test private validateFormControlOutlineMarkup(formControl: FormControl): ValidationErrors | null {
				const outlineMarkup = /<(h[1-6]|ol|ul)\b[^>]*>/i;
				return outlineMarkup.test(formControl.value) ? null : { outlineMarkup: 'Text does not contain any outline formatting' };
			}
				Procedure Writing Best Practices Essentials for Generative AI
Act as an expert technical writer of detailed, best practice, outline-format, business process standard operating procedures (SOPs) for any prompted topic strictly adhering to the following guidance:
Procedures
Scoping Procedures Make sure to follow  the below best practices.
Group by goal and task dependence: Consider the immediate business objective first to identify the steps that must be followed to reach that goal, regardless of who will execute them. Any steps that are interdependent or must otherwise be properly sequenced should be part of a single procedure so that those following it can understand those dependencies and the part they are playing in achieving the goal. However, if steps may run in parallel without dependency and are executed by different people or workgroups, it probably makes sense to create separate procedures for each.
Segment by triggering condition: An actionable procedure has a limited scope, defined by the triggering condition which initiates it and the goal of the work it accomplishes. While it’s tempting to include everything related to a topic in a single procedure, doing so can overwhelm or confuse readers and prevents it from being easily used to coordinate and track work. For example, “Asset Inventory Management” is a process area too broad to be captured in a single procedure and should instead be broken into at least four separate procedures, according to the independent condition triggering its execution. Procedure / Trigger Examples:
Asset Receipt / Procured asset physically received
Asset Assignment/Transfer / Asset (re)assigned to employee or location
Asset Disposal / Asset is physically disposed of
Asset Audit /Annually, April
Naming Procedures
Use concise, descriptive, unique, subject-action noun phrases: Start your procedure name with the subject it addresses, followed by the specific action executing the procedure accomplishes, for example: "Expense Report Filing", "Expense Report Generation", "Expense Report Reconciliation". Starting with the topic keeps related procedures automatically alphabetized together. Ending with the action ("filing", "reconciliation") makes the activity carried out clear. Using a phrase instead of a full sentence makes the name easily comprehensible and short enough to show up in list views.
Omit unnecessary words: Avoid using words that are applicable in all procedure names, such as starting the name with "How to" or ending with "Procedure", as these redundant words obscure the topic and make searching more difficult.
Use title case: Capitalize each important word in the name to differentiate Procedure names from Step names.
Use symbols, acronyms, & typographic symbols: While you should be cautious about using unfamiliar acronyms or abbreviations that may be ambiguous or difficult to read, using well-understood or previously defined acronyms and abbreviations, as well as common typographic symbols to substitute for words ("&" for "and", "%" for "percent", "/" for "or") can keep names short and easy to parse.
Surround procedure names with H1 tags
Describing Procedures
Procedure descriptions provide important context for those who assign work. Descriptions should immediately follow the procedure name as HTML formatted text.
Answer the following basic interrogatives as applicable within the description:
What…
for: What is the immediate objective or end result of carrying out these work instructions?
else: What other procedures are closely related?
Why: What is the higher-level goal that motivates executing this procedure?
Who…
is interested: Who should be aware of these work instructions and who should know when work is executed?
is qualified: What knowledge, skills, abilities, training, or certification form prerequisites for executing this procedure?
is permitted: What role, permission, or authorization must the assignees of this procedure have before executing it?
When…
Occasion: What precondition or event triggers the execution of this procedure?
Frequency: How often is this procedure carried out?
Duration: How long should the procedure take to execute?
Where…
Location: Where is the work to be carried out?
Permitted: What statutory or safety restrictions, if any, control where work may be executed?
With What…
Materials: What consumable resources or parts are required to execute this procedure?
Tools: What tools are required or useful to execute this procedure?
Steps
Defining Steps
Follow the sequence of work: To be easy to execute, the Step outline should mirror the sequence of actions in the underlying process being documented.
Identify a specific action: Create a step for every action required to complete the overall procedure that must be tracked separately for work coordination/collaboration/communication, or for reporting or auditing purposes. Explanations of how to perform steps that don't need to be tracked separately may be included as Step detail or as Content (see Describing Steps below).
Grouping Steps
Group related steps: When a series of Steps are closely related and can be summarized by a higher-level objective or phase in the Procedure, consider grouping them together as substeps to make the Procedure easy to grasp at a glance.
Keep steps at the same logical level: For simplicity of understanding, the nature of tasks or activities should be consistent at each level of the outline. A “nit-picky” detail such as a specific action to take (“send an e-mail with the title “Time Off Request”) should not be at the same level in the outline as a general description of work (“Request time off”). Likewise, such general descriptions should not be at the same outline as even broader section/phase headings (“Request”, “Approval”, “Appeal” …) that may be appropriate to include for particularly long procedures.
Consider the skill of the assignees: Those already familiar with the Procedure's work requirements need much less specific instructions than those who have never done the work before. An employee very familiar with the work may need only to scan the top level steps in the outline, while someone unfamiliar can drill-down into as much detail as needed.
Keep subsections short: If the number of steps in a logical grouping exceeds that range, consider breaking it down into several smaller groupings at a lower level in the outline.
Naming Steps
The effectiveness of an outline is dependent on its contents being well-written and easy to digest at each step. Since an outline allows additional details to be described at lower levels in the outline, each step should be kept short and consistent with its siblings.
Use phrases, not complete sentences: To make the procedure easy to execute, each step should be understandable at-a-glance. A concise and clearly descriptive phrase quickly conveys intent: “Return completed W-2 to HR”, not “When completed, the employee should return the W-2 form to HR.”
Use symbols, acronyms, & typographic symbols: While you should be cautious about using unfamiliar acronyms or abbreviations that may be ambiguous or difficult to read, using well-understood or previously defined acronyms and abbreviations, as well as common typographic symbols to substitute for words ("&" for and, "%" for "percent", "/" for "or") can keep step names short and easy to parse.
Name action steps with verb phrases: Lower-level steps that prescribe a concrete action should use the imperative mood to give the action prominence by starting with the appropriate action verb, for example: “Send e-mail to HR”, “Complete W-2 Form”, …
Name grouping steps with noun or gerund phrases: Very long procedures may benefit from being grouped into logical sections that describe a phase of the process rather than particular actions. If an outline level does not prescribe any particular action but merely groups together steps that in turn describe actions to be taken, start the step name with a noun phrase, such as: “Project Planning”, Project Initiation”, “Project Execution”, “Project Completion”. Alternatively, use a gerund phrase, such as: "Initiating the Time Off Request", "Completing the Pro Forma Submission Requirements".
Use decision verbs for branching logic: If a procedure has multiple possible completion paths based on a decision that must be taken at some step, use a decision verb (or equivalent gerund) like "decide/deciding" or "determine/determining" in the verb phrase (for action steps) or gerund phrase (for grouping steps).
Indicate actors if important: If a Procedure includes hand-offs between multiple actors, consider including the role in the step name parenthetically at the end: “Complete W2- Form [Employee]”, “Approve or deny leave request [Supervisor]”). Alternatively, this information may be included as detail within each step, as described below.
Surround all step names with the H2-H4 HTML tag appropriate for its level in the outline.
Describing Steps
Related resources & additional information that explains a Step but that does not have to be tracked separately for workflow communication/collaboration, reporting, or auditing (and therefore be a substep) should be included as Step detail immediately following the Step name, as HTML formatted text. Step detail may:
Provide just-in-time training: A primary purpose of providing Step detail or Content is to provide the detailed work instructions and training on how to perform the Step's action if it's not obvious to everyone who may carry out the Step solely from its name.
Identify acceptance criteria: Detailing the feedback or end states that demonstrates that the Step's action has been performed properly or improperly can be helpful in quality assurance.
Call out cautions: Always include any appropriate notice of safety or other hazards that may arise while performing the Step. Use the following language to consistently communicate the hazard level, in decreasing order of severity:
Danger: Near certain likelihood of death or serious injury [call out before step explanation in red boldface]
Warning: Possible injury or death OR serious damage to equipment [call out before step explanation in red boldface]
Caution: Possible minor injury or damage to equipment [call out before step explanation in red boldface]
Make sure to add description between the headers
Note: clarification [call out in boldface]


	 @Injectable({ providedIn: 'root' })
	 export class ProcedureFromDocumentService {
		private parser = new DOMParser();

		public constructor(private procedureMutationsService: ProcedureMutationsService) {
		}

		public createProcedureFromDocument(
			HTMLString: string,
			accountId: string,
			manualId: string,
			includeLists = false,
		): Observable<MutationResult<IProcedureCreate_ResponseData>> {
			const documentModel = this.parser.parseFromString(HTMLString, 'text/html');
			const procedureCreateMutation: IProcedureCreate_RequestVariables = {
				accountId: accountId,
				manualId: manualId,
			};
			let stepsRoot = createDocumentOutline(documentModel.body, includeLists).sections;
			if (stepsRoot.length === 1) {
				procedureCreateMutation.name = truncateWithEllipsis(getSectionHeadingText(stepsRoot[0]));
				procedureCreateMutation.detail = serializeNodes(stepsRoot[0].associatedNodes);
				stepsRoot = stepsRoot[0].sections;
			} else {
				const procedureName = documentModel.title
					|| stepsRoot[0].associatedNodes.find((associatedNode) => associatedNode.nodeType === Node.TEXT_NODE)?.textContent;
				procedureCreateMutation.name = procedureName ? truncateWithEllipsis(procedureName) : 'Untitled Procedure';
			}
			procedureCreateMutation.procedureStepInputList = this.buildProcedureStepInputList(stepsRoot);
			return this.procedureMutationsService.create(procedureCreateMutation);
		}

		private buildProcedureStepInputList(sections: Section[]): IProcedureStepInput[] {
			const procedureStepInputList = [];
			for (const section of sections) {
				const [truncatedStepName, detailPrependText] = this.splitStringAtSemanticBoundary(getSectionHeadingText(section));
				procedureStepInputList.push({
					name: truncatedStepName,
					detail: detailPrependText.length === 0
						? serializeNodes(section.associatedNodes)
						: \${detailPrependText}

					\${serializeNodes(section.associatedNodes)},
					procedureStepDocumentList: this.buildProcedureStepInputList(section.sections),
				});
			}
			return procedureStepInputList;
		}

		/**
		 * Splits a string into two strings at a semantic boundary less than a specified maximum length with fallbacks
		 * @param {string} stringToSplit - input string to process
		 * @param {number} maxLength - maximum length of 1st substring
		 * @param {boolean} addEllipses - append/prepend Unicode ellipsis character (U+2026) to show truncation/continuation
		 * @returns {[string, string]}
		 */
		private splitStringAtSemanticBoundary(
			stringToSplit: string,
			maxLength = 111,
			addEllipses = true,
		): [string, string] {
			if (stringToSplit.length <= maxLength) {
				return [stringToSplit, ''];
			} else {
				const effectiveMaxLength = addEllipses ? maxLength - 1 : maxLength;
				const substring = stringToSplit.slice(0, effectiveMaxLength);
				// Look for the last punctuation boundary within effectiveMaxLength
				const punctuationRegex = /[.,;:!?()](?=\s|$)/g;
				const punctuationMatches = Array.from(substring.matchAll(punctuationRegex));
				const punctuationIndex = punctuationMatches.length > 0
					? punctuationMatches[punctuationMatches.length - 1].index + 1
					: -1;
				// Calculate fallback split at the last space within effectiveMaxLength
				const spaceIndex = substring.lastIndexOf(' ');
				let splitIndex: number;
				if (punctuationIndex !== -1 && (punctuationIndex >= effectiveMaxLength / 3 || spaceIndex === -1)) {
					// Prefer punctuation if it results in a first part >= 1/3 of maxLength
					splitIndex = punctuationIndex;
				} else if (spaceIndex !== -1) {
					// Fallback to space
					splitIndex = spaceIndex;
				} else {
					// Default to maxLength if no punctuation or space is found
					splitIndex = effectiveMaxLength;
				}
				// Prepare the split strings
				let part1 = stringToSplit.slice(0, splitIndex).trim();
				let part2 = stringToSplit.slice(splitIndex).trim();
				// Add ellipses if specified
				if (addEllipses) { // Use the Unicode ellipsis character (U+2026)
					part1 = \${part1}…;
					part2 = …\${part2};
				}
				return [part1, part2];
			}
		}
	 } Look at the above code what structure can you best Procedure to make the procedure as you are using this to convert the HTML yOU MAKE remember you are a SOP (Standard Operating Procedure) writer. ALSO ADD POSSIBLE REVELENT LINKS FOR THE CONT AND DESCRIPTION.
	  `;

    return this.invokeModelWithRequest(request);
  }

	private async generateFinalProcedure_2(): Promise<string> {
		await this.initializeBedrockClient();

		const request = `
	Here is the collected information for the procedure:
	${JSON.stringify(TextGenerationService.userResponses)}

	Your task is to generate a valid JSON object that can be directly used as the input for the following GraphQL mutation:
	mutation ProcedureCreate($accountId: ID!, $manualId: ID!, ...) {
		ProcedureCreate(
			accountId: $accountId,
			manualId: $manualId,
			name: $name,
			description: $description,
			detail: $detail,
			keywordList: $keywordList,
			sectorList: $sectorList,
			functionList: $functionList,
			procedureStepInputList: $procedureStepInputList
		) { ... }
	}

	Please return a JSON object of this format:
	{
		"accountId": "string",
		"manualId": "string",
		"name": "string",
		"description": "string",
		"detail": "string (rich text or HTML)",
		"status": "string (e.g., Draft, Published)",
		"isCopyProtected": true,
		"keywordList": ["string"],
		"sectorList": ["string"],
		"functionList": ["string"],
		"procedureStepInputList": [
			{
				"stepIndex": number,
				"name": "string",
				"description": "string (HTML or plain text)",
				"stepType": "Normal" | "SubProcedure" | "Reference"
			}
		]
	}  and this are the import { isRefType } from '@typegoose/typegoose';

	import { DomainEntityBase } from '../../core/domain/domain-entity-base.model';
	import { ProcedureStatus } from './procedure-status.type';
	import { Content, IContent } from '../content/content.model';
	import { IProcedureStep, ProcedureStep } from '../procedure-step/procedure-step.model';
	import { DomainEntityTypeName } from '../../core/domain/domain-entity-type-name.types';
	import { newEntityId } from '../../core/domain/entity-id.methods';
	import { StaticId } from '../../core/infrastructure/types/static-id.enum';
	import { IManual } from '../manual/manual.model';
	import { OmitMethodKeys } from '../../core/infrastructure/types/utility.types';
	import { populate } from '../../core/infrastructure/methods/populate.method';
	import { IEntityActivity } from '../../common/activity-list/entity-activity.model';
	import { IAssignmentSummary } from '../../common/assignment-summary/assignment-summary.model';
	import { IAssignment } from '../../inbox/assignment/assignment.type';
	import { IAccount } from '../../common/account/account.model';
	import type { IProcedureDocument } from './procedure-document.type';
	import type { IProcedureStepDocument } from '../procedure-step/procedure-step-document.type';


	/** Data Transfer Object of Procedure
	 *  Methods removed & properties marked optional to create accurate GraphQL DTO of Domain Entity
	 *
	 *  @ToDo: consider renaming with DTO suffix
	 */
	export interface IProcedure extends OmitMethodKeys<Partial<Procedure>> {
		imagePreviewURL?: string; // client-only virtual property resolved by ApolloClient local resolver
	}

	/** domain model class: A named, ordered, hierarchically nested collection of 0 or more Procedure Steps providing a template for Assignments > Tasks */
	export class Procedure extends DomainEntityBase {
		public name: string = '';
		public description: string = '';
		public detail: string = '';
		public status: ProcedureStatus = ProcedureStatus.Draft;
		public isCopyProtected: boolean = false;
		public dateTimeRevised: Date = new Date();
		public imageLocator: string = '';
		public sectorList: string[] = [];
		public functionList: string[] = [];
		public keywordList: string[] = [];
		public procedureStepList: IProcedureStep[] = [];
		public contentList: IContent[] = []; // Managed by external resolver
		public defaultAssigneeAccount: IAccount = null; // Managed by external resolver
		public manual: IManual; // Managed by external resolver
		public assignmentSummaryList: IAssignmentSummary[] = []; // Managed by external resolver
		public assignmentList: IAssignment[] = []; // Managed by external resolver
		public activityList: IEntityActivity[] = []; // Managed by external resolver
		public readonly __typename: DomainEntityTypeName.Procedure = DomainEntityTypeName.Procedure;

		public constructor(initialValues?: IProcedureDocument) {
			super();
			if (initialValues) {
				populate<IProcedure>(this, initialValues);
				this.manual = { _id: initialValues.manualId };
				const childDocumentList = initialValues.procedureStepDocumentList.filter((childDocument: IProcedureStepDocument) => {
					if (childDocument._id === StaticId.DefaultChild) {
						this.name = childDocument.name;
						this.detail = childDocument.detail;
						this.defaultAssigneeAccount = isRefType(childDocument.defaultAssigneeAccountId, String) ? { _id: childDocument.defaultAssigneeAccountId } : undefined;
						this.contentList = childDocument.contentIdList.map((contentId) => {
							return isRefType(contentId, String) ? { _id: contentId } : new Content(contentId);
						});
					}
					return childDocument._id !== StaticId.DefaultChild;
				});
				this.procedureStepList = childDocumentList.map((childDocument: IProcedureStepDocument) => {
					return new ProcedureStep(this, childDocument);
				});
			}
			this._id = this._id || newEntityId();
		}
	}

	export const procedureStepListMaximumDepth = 4;
	and export interface IProcedureStepInput {
	name?: string;
	detail?: string;
	procedureStepDocumentList?: IProcedureStepInput[];
}


Output strictly as JSON only. Do not include any comments or explanations.  YOU NEED TO MAKE THIS JSON AS DEEP AS POSSIBLE AND PROCFESSIONAL SOP.
	`;

		const jsonResponse = await this.invokeModelWithRequest(request);

		try {
			const parsed = JSON.parse(jsonResponse);
			return jsonResponse;
		} catch (e) {
			this.messageService.publish(
				new UserNotificationMessage('The AI returned an invalid JSON structure.', UserNotificationType.Error)
			);
			return '';
		}
	}

/**
 * Edits an existing procedure HTML based on the provided instructions
 * @param procedureHtml The current procedure HTML to edit
 * @param editInstructions Specific instructions for what to modify
 * @returns Promise<string> The edited procedure HTML
 */
public async editProcedureContent(
  procedureHtml: string,
  editInstructions: string
): Promise<string> {
  try {
    if (!this.isTextGenerationEnabled) {
      throw new Error('Text generation is not enabled');
    }

    if (!procedureHtml || !editInstructions) {
      throw new Error('Procedure content and edit instructions are required');
    }

    await this.initializeBedrockClient();

    const request = `
You are an expert technical editor for Standard Operating Procedures. Please edit the following procedure HTML based on the provided instructions.

ORIGINAL PROCEDURE HTML:
"""
${procedureHtml}
"""

EDIT INSTRUCTIONS:
"""
${editInstructions}
"""

EDITING REQUIREMENTS:
1. Make ONLY the requested changes
2. Preserve ALL original HTML structure and formatting
3. Maintain the exact same heading hierarchy
4. Keep all lists with their original formatting
5. Do NOT add any new sections unless explicitly requested
6. Maintain all existing safety warnings and notes
7. Return ONLY the edited HTML with no additional commentary

TECHNICAL REQUIREMENTS:
- The HTML must be parsable by a DOM parser
- Procedure steps will be extracted based on heading hierarchy
- All formatting must be preserved exactly
- No text outside of HTML tags should be present

OUTPUT REQUIREMENTS:
- Start directly with the procedure content
- Maintain all original HTML tag structure
- Return only the edited HTML procedure
`;

    const editedHtml = await this.invokeModelWithRequest(request);

    // Basic check for HTML tags
    if (!editedHtml.includes('<') || !editedHtml.includes('>')) {
      throw new Error('Edited content is not valid HTML');
    }

    return editedHtml;
  } catch (error) {
    console.error('Failed to edit procedure:', error);
    this.messageService.publish(
      new UserNotificationMessage('Failed to edit procedure. Please check your edit instructions.', UserNotificationType.Error)
    );
    return Promise.resolve(procedureHtml);
  }
}

  /** Builds the appropriate text request based on type */
  private buildRequest(
    type: Exclude<TextGenerationType, TextGenerationType.Ask>,
    payload: string,
    subtype?: string
  ): string {
    switch (type) {
      case TextGenerationType.Rephrase:
        return `Rephrase this piece of text: ${payload}`;
      case TextGenerationType.Translate:
        return `Translate this piece of text to ${subtype}: ${payload}`;
      case TextGenerationType.Elaborate:
        return `Elaborate this piece of text: ${payload}`;
      case TextGenerationType.Summarize:
        return `Summarize this in 2 or 3 lines of 100-200 characters: ${payload}`;
      default:
        return '';
    }
  }

  /** Centralized model invocation */
  private async invokeModelWithRequest(request: string): Promise<string> {
    const modelParams = {
      modelId: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        system: `Provide a direct response without prefatory phrases like "here is a response" or "here is how you can". The request may be formatted with HTML. Return HTML tags only if tags are given and required to maintain formatting. Don't consider \\n as paragraphs.`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: request,
              },
            ],
          },
        ],
        max_tokens: 2048,
        temperature: 0.9,
        top_p: 0.99,
        top_k: 250,
      }),
    };

    try {
      const data = await this.bedrockClient.invokeModel(modelParams);
      const responseBody = JSON.parse(Buffer.from(data.body).toString('utf-8'));
      if (responseBody?.content?.[0]?.text) {
        return responseBody.content[0].text;
      } else {
        throw new Error('Invalid response from the model');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error while generating text';
      this.messageService.publish(new UserNotificationMessage(errorMessage, UserNotificationType.Error));
      return '';
    }
  }
}
